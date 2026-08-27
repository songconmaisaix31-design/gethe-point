import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from common import FleetError  # noqa: E402
from fleet import build_state, dispatch_id_from_receipt, dispatch_wave, do_launch, settle_worker  # noqa: E402


class DispatchReceiptTests(unittest.TestCase):
    def test_current_orca_context_dispatch_id_wins_over_effect_name(self):
        receipt = {
            "result": {
                "dispatchId": "ctx_281af24e0d31",
                "effects": [{"kind": "dispatch_input", "state": "accepted"}],
            }
        }

        self.assertEqual(dispatch_id_from_receipt(receipt), "ctx_281af24e0d31")

    def test_legacy_dispatch_id_is_supported(self):
        receipt = {"result": {"dispatch_id": "dispatch_abc123"}}

        self.assertEqual(dispatch_id_from_receipt(receipt), "dispatch_abc123")

    def test_dispatch_input_effect_is_not_an_id(self):
        receipt = {"result": {"effects": [{"kind": "dispatch_input"}]}}

        self.assertIsNone(dispatch_id_from_receipt(receipt))


class WorkspaceNamingTests(unittest.TestCase):
    def test_explicit_suffix_makes_retry_workspaces_distinct(self):
        plan = {
            "objective": "test",
            "workspace_suffix": "v2",
            "waves": [
                {
                    "id": "foundation",
                    "base": {"type": "ref", "value": "origin/main"},
                    "tasks": [{"id": "FOUND-001", "track": "foundation"}],
                }
            ],
        }

        state = build_state(
            plan,
            "run_test",
            Path("run"),
            "id:repo_test",
            "origin/main",
            "0" * 40,
            "fleet-control-test",
        )

        self.assertEqual(state["tasks"]["FOUND-001"]["workspace_name"], "trk-foundation-found-001-v2")


class WorkerSettlementTests(unittest.TestCase):
    @patch("fleet.orca", side_effect=FleetError("tab_not_found"))
    def test_cleanup_failure_is_recorded_without_raising(self, _orca):
        receipt = settle_worker(Path("."), "worker-release", "ctx_281af24e0d31")

        self.assertFalse(receipt["ok"])
        self.assertEqual(receipt["dispatch_id"], "ctx_281af24e0d31")
        self.assertIn("tab_not_found", receipt["error"])


class DispatchRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run_dir = self.root / "run"
        (self.run_dir / "evidence").mkdir(parents=True)
        self.state_path = self.run_dir / "state.json"
        self.wave = {
            "id": "contract",
            "tasks": ["CONTRACT-001"],
            "status": "planned",
            "depends_on": [],
            "base": {"type": "ref", "value": "origin/foundation"},
        }
        self.state = {
            "run_id": "run_test",
            "objective": "test dispatch recovery",
            "coordinator_branch": "fleet-control-test",
            "initial_base_ref": "origin/main",
            "initial_base_sha": "0" * 40,
            "created_at": "2026-08-27T00:00:00Z",
            "updated_at": "2026-08-27T00:00:00Z",
            "run_dir": str(self.run_dir),
            "repo_selector": "id:repo_test",
            "waves": [self.wave],
            "tasks": {
                "CONTRACT-001": {
                    "id": "CONTRACT-001",
                    "title": "Freeze contracts",
                    "track": "architecture",
                    "workspace_name": "trk-architecture-contract-001-v2",
                    "status": "planned",
                    "orca_task_id": None,
                    "dispatch_id": None,
                    "branch": None,
                }
            },
        }

    def tearDown(self):
        self.temp.cleanup()

    @patch("fleet.render_spec", return_value="contract spec")
    @patch("fleet.resolve_wave_base", return_value=("origin/foundation", "a" * 40))
    def test_worker_start_failure_persists_task_id_and_retry_reuses_it(self, _base, _spec):
        first_calls = []

        def first_orca(_root, args, _label, _dry_run=False):
            first_calls.append(args)
            if args[:2] == ["repo", "set-base-ref"]:
                return {"ok": True}
            if args[:2] == ["orchestration", "task-create"]:
                return {"result": {"taskId": "task_abc123"}}
            raise FleetError("selector_not_found")

        with patch("fleet.orca", side_effect=first_orca):
            with self.assertRaisesRegex(FleetError, "selector_not_found"):
                dispatch_wave(self.root, {}, self.state, self.wave, self.state_path, False)

        persisted = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["tasks"]["CONTRACT-001"]["orca_task_id"], "task_abc123")
        self.assertEqual(sum(call[:2] == ["orchestration", "task-create"] for call in first_calls), 1)

        second_calls = []

        def second_orca(_root, args, _label, _dry_run=False):
            second_calls.append(args)
            if args[:2] == ["repo", "set-base-ref"]:
                return {"ok": True}
            if args[:2] == ["orchestration", "worker-start"]:
                return {
                    "result": {
                        "dispatchId": "ctx_abc123",
                        "branch": "trk-architecture-contract-001-v2",
                    }
                }
            raise AssertionError(f"unexpected Orca call: {args}")

        with patch("fleet.orca", side_effect=second_orca):
            dispatch_wave(self.root, {}, persisted, self.wave, self.state_path, False)

        self.assertFalse(any(call[:2] == ["orchestration", "task-create"] for call in second_calls))
        worker_start = next(call for call in second_calls if call[:2] == ["orchestration", "worker-start"])
        self.assertEqual(worker_start[worker_start.index("--base-branch") + 1], "origin/foundation")
        self.assertEqual(persisted["tasks"]["CONTRACT-001"]["dispatch_id"], "ctx_abc123")
        self.assertEqual(persisted["tasks"]["CONTRACT-001"]["status"], "dispatched")


class LaunchAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.plan_path = self.root / "plan.json"
        self.args = argparse.Namespace(
            plan=self.plan_path,
            dry_run=False,
            json=False,
        )

    def tearDown(self):
        self.temp.cleanup()

    def write_plan(self, *, status: str, authorized: bool) -> None:
        self.plan_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "plan_status": status,
                    "launch_authorized": authorized,
                    "objective": "test",
                    "waves": [],
                }
            ),
            encoding="utf-8",
        )

    @patch("fleet.orca")
    @patch("fleet.fetch")
    @patch("fleet.repo_selector")
    def test_draft_plan_is_rejected_before_external_state(
        self,
        repo_selector,
        fetch,
        orca,
    ):
        self.write_plan(status="draft", authorized=False)

        with self.assertRaisesRegex(FleetError, "plan_status must be approved"):
            do_launch(self.root, {}, self.args)

        repo_selector.assert_not_called()
        fetch.assert_not_called()
        orca.assert_not_called()

    @patch("fleet.orca")
    @patch("fleet.fetch")
    @patch("fleet.repo_selector")
    def test_unauthorized_plan_is_rejected_before_external_state(
        self,
        repo_selector,
        fetch,
        orca,
    ):
        self.write_plan(status="approved", authorized=False)

        with self.assertRaisesRegex(FleetError, "launch_authorized must be true"):
            do_launch(self.root, {}, self.args)

        repo_selector.assert_not_called()
        fetch.assert_not_called()
        orca.assert_not_called()


if __name__ == "__main__":
    unittest.main()
