import argparse
import copy
import io
import json
import multiprocessing
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import common as common_module  # noqa: E402
import fleet as fleet_module  # noqa: E402
from common import FleetError, run_state_lock, save_json, sha256_file  # noqa: E402
from fleet import (  # noqa: E402
    acceptance_evidence_path,
    do_accept,
    do_amend,
    do_finalize,
    status_markdown,
)


def _accept_failed_process(state_path: str, task_id: str, barrier, results) -> None:
    args = argparse.Namespace(
        state=Path(state_path),
        task=task_id,
        branch=None,
        sha=None,
        outcome="failed",
        summary=f"{task_id} rejected",
        retain=False,
        advance=False,
        dry_run=False,
        json=True,
    )
    fleet_module.settle_worker = lambda *_args, **_kwargs: {"ok": True}
    try:
        barrier.wait(timeout=10)
        with redirect_stdout(io.StringIO()):
            do_accept(Path(state_path).parent, {}, args)
        results.put((task_id, "ok"))
    except BaseException as exc:  # pragma: no cover - surfaced through the parent assertion
        results.put((task_id, f"{type(exc).__name__}: {exc}"))


def _hold_state_lock_process(state_path: str, ready, release) -> None:
    with run_state_lock(Path(state_path)):
        ready.set()
        release.wait(timeout=10)


def task_state(
    task_id: str,
    track: str,
    wave: str,
    status: str,
    workspace: str,
    write_paths: list[str],
) -> dict:
    terminal = status in ("completed", "failed")
    dispatched = status in ("dispatched", "completed", "failed")
    return {
        "id": task_id,
        "title": task_id,
        "track": track,
        "write_paths": write_paths,
        "spec": f"Implement {task_id}",
        "acceptance": [f"Verify {task_id}"],
        "checks": [],
        "wave": wave,
        "status": status,
        "workspace_name": workspace,
        "orca_task_id": f"task_{task_id.lower().replace('-', '')}" if dispatched else None,
        "dispatch_id": f"ctx_{task_id.lower().replace('-', '')}" if dispatched else None,
        "branch": workspace if dispatched else None,
        "base_ref": "origin/base" if dispatched else None,
        "base_sha": "1" * 40 if dispatched else None,
        "head_sha": "2" * 40 if status == "completed" else None,
        "summary": status if terminal else None,
        "dispatched_at": "2026-08-27T00:00:00Z" if dispatched else None,
        "completed_at": "2026-08-27T01:00:00Z" if terminal else None,
    }


class AmendmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir()
        self.state_path = self.run_dir / "state.json"
        self.plan_path = self.run_dir / "plan.json"
        self.amendment_path = self.root / "amendment.json"
        self.plan = {"schema_version": 1, "plan_id": "parent-plan"}
        save_json(self.plan_path, self.plan)
        self.cfg = {
            "tracks": {
                "data": {"allow": ["packages/db/**"]},
                "experience": {"allow": ["apps/web/**"]},
                "integration": {"allow": ["apps/web/src/integration/**"]},
            }
        }
        self.state = {
            "schema_version": 1,
            "run_id": "run_abc123",
            "objective": "repair test",
            "created_at": "2026-08-27T00:00:00Z",
            "updated_at": "2026-08-27T00:00:00Z",
            "run_dir": str(self.run_dir),
            "repo_selector": "id:repo_test",
            "coordinator_branch": "fleet-control-test",
            "initial_base_ref": "origin/main",
            "initial_base_sha": "0" * 40,
            "waves": [
                {
                    "id": "database",
                    "description": "database",
                    "depends_on": [],
                    "base": {"type": "ref", "value": "origin/main"},
                    "tasks": ["DATA-001"],
                    "status": "completed",
                    "dispatched_at": "2026-08-27T00:00:00Z",
                    "completed_at": "2026-08-27T01:00:00Z",
                },
                {
                    "id": "core",
                    "description": "core",
                    "depends_on": ["DATA-001"],
                    "base": {"type": "task", "task": "DATA-001"},
                    "tasks": ["EXPR-001"],
                    "status": "failed",
                    "dispatched_at": "2026-08-27T01:00:00Z",
                    "completed_at": None,
                },
                {
                    "id": "alpha",
                    "description": "alpha",
                    "depends_on": ["DATA-001", "EXPR-001"],
                    "base": {"type": "task", "task": "DATA-001"},
                    "tasks": ["INT-001"],
                    "status": "blocked",
                    "dispatched_at": None,
                    "completed_at": None,
                },
            ],
            "tasks": {
                "DATA-001": task_state(
                    "DATA-001", "data", "database", "completed", "trk-data-data-001", ["packages/db/**"]
                ),
                "EXPR-001": task_state(
                    "EXPR-001", "experience", "core", "failed", "trk-experience-expr-001", ["apps/web/**"]
                ),
                "INT-001": task_state(
                    "INT-001",
                    "integration",
                    "alpha",
                    "planned",
                    "trk-integration-int-001",
                    ["apps/web/src/integration/**"],
                ),
            },
        }
        save_json(self.state_path, self.state)
        self.write_amendment()

    def tearDown(self):
        self.temp.cleanup()

    def amendment(self) -> dict:
        return {
            "schema_version": 1,
            "amendment_id": "repair-core-001",
            "description": "Append one replacement and retarget alpha integration.",
            "plan_status": "approved",
            "launch_authorized": True,
            "run_id": self.state["run_id"],
            "parent_plan_sha256": sha256_file(self.plan_path),
            "state_sha256": sha256_file(self.state_path),
            "automation": {
                "branch": "trk-automation-auto-repair-001-v2",
                "sha": "a" * 40,
            },
            "workspace_suffix": "repair-v1",
            "append_waves": [
                {
                    "id": "repair-experience",
                    "description": "Replace rejected experience Attempt",
                    "depends_on": ["DATA-001"],
                    "base": {"type": "task", "task": "DATA-001"},
                    "tasks": [
                        {
                            "id": "EXPR-REPAIR-001",
                            "title": "Repair experience runtime",
                            "track": "experience",
                            "write_paths": ["apps/web/next-env.d.ts", "apps/web/src/**"],
                            "spec": "Repair the rejected experience Attempt.",
                            "acceptance": ["Run the real application."],
                            "checks": ["pnpm run check:experience"],
                        }
                    ],
                }
            ],
            "update_waves": [
                {
                    "id": "alpha",
                    "depends_on": ["DATA-001", "EXPR-REPAIR-001"],
                    "base": {"type": "task", "task": "DATA-001"},
                }
            ],
            "update_tasks": [
                {
                    "id": "INT-001",
                    "spec": "Integrate only accepted replacement SHAs.",
                }
            ],
            "resolutions": [
                {
                    "task": "EXPR-001",
                    "superseded_by": "EXPR-REPAIR-001",
                }
            ],
        }

    def write_amendment(self, value: dict | None = None) -> dict:
        value = value or self.amendment()
        save_json(self.amendment_path, value)
        return value

    def args(self, *, dry_run: bool) -> argparse.Namespace:
        return argparse.Namespace(
            state=self.state_path,
            amendment=self.amendment_path,
            dry_run=dry_run,
            json=True,
        )

    def assert_rejected_without_mutation(self, pattern: str) -> None:
        before = self.state_path.read_bytes()
        with (
            patch("fleet.save_state") as save_state,
            patch("fleet.save_json") as save_json_mock,
            patch("fleet.orca") as orca,
            self.assertRaisesRegex(FleetError, pattern),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        self.assertEqual(self.state_path.read_bytes(), before)
        save_state.assert_not_called()
        save_json_mock.assert_not_called()
        orca.assert_not_called()

    def test_dry_run_materializes_dag_without_state_or_orca_mutation(self):
        before = self.state_path.read_bytes()
        with patch("fleet.orca") as orca, patch("builtins.print") as output:
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=True)), 0)

        result = json.loads(output.call_args.args[0])
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertFalse((self.run_dir / "STATUS.md").exists())
        self.assertFalse((self.run_dir / "evidence").exists())
        self.assertIn("EXPR-REPAIR-001", result["materialized"]["tasks"])
        self.assertEqual(
            next(wave for wave in result["materialized"]["waves"] if wave["id"] == "alpha")["depends_on"],
            ["DATA-001", "EXPR-REPAIR-001"],
        )
        orca.assert_not_called()

    def test_matching_cas_appends_and_preserves_historical_attempt(self):
        historical = copy.deepcopy(self.state["tasks"]["EXPR-001"])
        plan_before = self.plan_path.read_bytes()
        expected_state_hash = json.loads(self.amendment_path.read_text(encoding="utf-8"))["state_sha256"]
        with patch("fleet.orca") as orca, patch("builtins.print"):
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)

        amended = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(amended["tasks"]["EXPR-001"], historical)
        self.assertEqual(amended["tasks"]["INT-001"]["status"], "planned")
        self.assertEqual(amended["tasks"]["INT-001"]["spec"], "Integrate only accepted replacement SHAs.")
        self.assertEqual(amended["waves"][-1]["id"], "repair-experience")
        self.assertEqual(amended["resolutions"]["EXPR-001"]["superseded_by"], "EXPR-REPAIR-001")
        self.assertEqual(self.plan_path.read_bytes(), plan_before)
        receipt_path = Path(amended["amendments"][0]["receipt"])
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["state_before_sha256"], expected_state_hash)
        self.assertEqual(receipt["state_after_sha256"], sha256_file(self.state_path))
        orca.assert_not_called()

    def test_corrected_by_records_forward_fix_without_changing_original_outcome(self):
        amendment = self.amendment()
        amendment["append_waves"][0]["tasks"].append(
            {
                "id": "DATA-CORR-001",
                "title": "Correct accepted database baseline",
                "track": "data",
                "write_paths": ["packages/db/**"],
                "spec": "Apply a forward-only database correction.",
            }
        )
        amendment["resolutions"].append({"task": "DATA-001", "corrected_by": "DATA-CORR-001"})
        self.write_amendment(amendment)
        original = copy.deepcopy(self.state["tasks"]["DATA-001"])

        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["tasks"]["DATA-001"], original)
        self.assertEqual(state["resolutions"]["DATA-001"]["corrected_by"], "DATA-CORR-001")

    def test_reapplying_same_amendment_is_idempotent(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        applied = self.state_path.read_bytes()
        evidence = sorted((self.run_dir / "evidence").iterdir())

        with (
            patch("fleet.save_state") as save_state,
            patch("fleet.save_json") as save_json_mock,
            patch("fleet.orca") as orca,
            patch("builtins.print") as output,
        ):
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)

        result = json.loads(output.call_args.args[0])
        self.assertTrue(result["already_applied"])
        self.assertEqual(self.state_path.read_bytes(), applied)
        self.assertEqual(sorted((self.run_dir / "evidence").iterdir()), evidence)
        save_state.assert_not_called()
        save_json_mock.assert_not_called()
        orca.assert_not_called()

    def test_stale_state_hash_fails_before_write(self):
        amendment = self.amendment()
        amendment["state_sha256"] = "0" * 64
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("state SHA-256 precondition failed")

    def test_stale_parent_plan_hash_fails_before_write(self):
        amendment = self.amendment()
        amendment["parent_plan_sha256"] = "0" * 64
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("parent plan SHA-256 precondition failed")

    def test_unapproved_amendment_fails_before_write(self):
        amendment = self.amendment()
        amendment["plan_status"] = "draft"
        amendment["launch_authorized"] = False
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("plan_status must be approved")

    def test_unauthorized_amendment_fails_before_write(self):
        amendment = self.amendment()
        amendment["launch_authorized"] = False
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("launch_authorized must be true")

    def test_fresh_wave_cannot_redefine_existing_task(self):
        amendment = self.amendment()
        amendment["append_waves"][0]["tasks"][0]["id"] = "EXPR-001"
        amendment["resolutions"][0]["superseded_by"] = "EXPR-001"
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("existing Task mutation is forbidden")

    def test_existing_task_lifecycle_mutation_is_rejected(self):
        amendment = self.amendment()
        amendment["update_tasks"] = [{"id": "INT-001", "status": "completed"}]
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("Task or Dispatch mutation is forbidden")

    def test_existing_dispatch_mutation_is_rejected(self):
        amendment = self.amendment()
        amendment["update_tasks"] = [{"id": "INT-001", "dispatch_id": "ctx_new123"}]
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("Task or Dispatch mutation is forbidden")

    def test_dispatched_downstream_edit_is_rejected(self):
        self.state["tasks"]["INT-001"].update(
            {
                "status": "dispatched",
                "orca_task_id": "task_int123",
                "dispatch_id": "ctx_int123",
                "branch": "trk-integration-int-001",
                "base_ref": "origin/base",
                "base_sha": "1" * 40,
                "dispatched_at": "2026-08-27T02:00:00Z",
            }
        )
        save_json(self.state_path, self.state)
        self.write_amendment()
        self.assert_rejected_without_mutation("downstream wave alpha has already been dispatched")

    def test_duplicate_workspace_is_rejected(self):
        self.state["tasks"]["INT-001"]["workspace_name"] = "trk-experience-expr-repair-001-repair-v1"
        save_json(self.state_path, self.state)
        self.write_amendment()
        self.assert_rejected_without_mutation("duplicate workspace")

    def test_overlapping_write_paths_are_rejected(self):
        amendment = self.amendment()
        amendment["append_waves"][0]["tasks"].append(
            {
                "id": "EXPR-REPAIR-002",
                "title": "Second overlapping repair",
                "track": "experience",
                "write_paths": ["apps/web/src/components/**"],
                "spec": "Overlap the first repair.",
            }
        )
        self.write_amendment(amendment)
        self.assert_rejected_without_mutation("appears twice|overlap")

    def test_applied_amendment_id_cannot_be_reused_with_different_content(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        amendment = json.loads(self.amendment_path.read_text(encoding="utf-8"))
        amendment["description"] = "Different bytes under the same immutable ID."
        save_json(self.amendment_path, amendment)
        with self.assertRaisesRegex(FleetError, "already applied with different content"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

    def test_failed_source_cannot_use_corrected_by(self):
        amendment = self.amendment()
        amendment["resolutions"] = [{"task": "EXPR-001", "corrected_by": "EXPR-REPAIR-001"}]
        self.write_amendment(amendment)

        self.assert_rejected_without_mutation("corrected task EXPR-001 must already be completed")

    def test_completed_source_cannot_use_superseded_by(self):
        amendment = self.amendment()
        amendment["resolutions"] = [{"task": "DATA-001", "superseded_by": "EXPR-REPAIR-001"}]
        self.write_amendment(amendment)

        self.assert_rejected_without_mutation("superseded task DATA-001 must already be failed")

    def add_unrelated_planned_wave(self) -> None:
        self.state["waves"].append(
            {
                "id": "unrelated",
                "description": "unrelated",
                "depends_on": [],
                "base": {"type": "ref", "value": "origin/main"},
                "tasks": ["UNRELATED-001"],
                "status": "planned",
                "dispatched_at": None,
                "completed_at": None,
            }
        )
        self.state["tasks"]["UNRELATED-001"] = task_state(
            "UNRELATED-001", "data", "unrelated", "planned", "trk-data-unrelated-001", ["packages/db/**"]
        )
        save_json(self.state_path, self.state)

    def test_unrelated_never_dispatched_wave_cannot_be_patched(self):
        self.add_unrelated_planned_wave()
        amendment = self.amendment()
        amendment["update_waves"].append({"id": "unrelated", "description": "Not downstream."})
        self.write_amendment(amendment)

        self.assert_rejected_without_mutation("wave unrelated is not downstream of any resolved source")

    def test_unrelated_never_dispatched_task_cannot_be_patched(self):
        self.add_unrelated_planned_wave()
        amendment = self.amendment()
        amendment["update_tasks"].append({"id": "UNRELATED-001", "spec": "Not downstream."})
        self.write_amendment(amendment)

        self.assert_rejected_without_mutation("task UNRELATED-001 is not downstream of any resolved source")

    def test_failure_before_journal_publication_has_no_effect(self):
        before = self.state_path.read_bytes()
        with (
            patch("fleet.publish_amendment_journal", side_effect=RuntimeError("before journal")),
            patch("builtins.print"),
            self.assertRaisesRegex(RuntimeError, "before journal"),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertFalse((self.run_dir / "STATUS.md").exists())
        self.assertFalse((self.run_dir / "evidence").exists())

    def test_replay_after_journal_publication_failure_commits_once(self):
        before = self.state_path.read_bytes()
        publish = fleet_module.publish_amendment_journal

        def publish_then_fail(path: Path, data: bytes) -> None:
            publish(path, data)
            raise RuntimeError("after journal")

        with (
            patch("fleet.publish_amendment_journal", side_effect=publish_then_fail),
            patch("builtins.print"),
            self.assertRaisesRegex(RuntimeError, "after journal"),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertEqual(len(list((self.run_dir / "evidence").glob("*.journal.json"))), 1)
        with patch("builtins.print"):
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(len(state["amendments"]), 1)
        self.assertEqual(len([wave for wave in state["waves"] if wave["id"] == "repair-experience"]), 1)

    def test_replay_after_state_replacement_repairs_derived_artifacts(self):
        replace = fleet_module.replace_amendment_state

        def replace_then_fail(path: Path, data: bytes) -> None:
            replace(path, data)
            raise RuntimeError("after state")

        with (
            patch("fleet.replace_amendment_state", side_effect=replace_then_fail),
            patch("builtins.print"),
            self.assertRaisesRegex(RuntimeError, "after state"),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        record = state["amendments"][0]
        self.assertFalse(Path(record["receipt"]).exists())
        self.assertFalse(Path(record["status"]).exists())
        with patch("builtins.print") as output:
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)
        self.assertTrue(json.loads(output.call_args.args[0])["already_applied"])
        self.assertTrue(Path(record["receipt"]).exists())
        self.assertTrue(Path(record["status"]).exists())

    def test_replay_repairs_missing_receipt_after_receipt_write_failure(self):
        with (
            patch("fleet.publish_amendment_receipt", side_effect=RuntimeError("during receipt")),
            patch("builtins.print"),
            self.assertRaisesRegex(RuntimeError, "during receipt"),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        receipt_path = Path(state["amendments"][0]["receipt"])
        self.assertFalse(receipt_path.exists())
        with patch("builtins.print"):
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)
        self.assertTrue(receipt_path.exists())

    def test_replay_repairs_missing_status_after_status_write_failure(self):
        with (
            patch("fleet.publish_amendment_status", side_effect=RuntimeError("during STATUS")),
            patch("builtins.print"),
            self.assertRaisesRegex(RuntimeError, "during STATUS"),
        ):
            do_amend(self.root, self.cfg, self.args(dry_run=False))

        self.assertFalse((self.run_dir / "STATUS.md").exists())
        with patch("builtins.print"):
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual((self.run_dir / "STATUS.md").read_bytes(), fleet_module.status_bytes(state))

    def test_already_applied_repairs_stale_derived_status_before_reporting(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        status_path = self.run_dir / "STATUS.md"
        status_path.write_text("stale\n", encoding="utf-8")

        with patch("builtins.print") as output:
            self.assertEqual(do_amend(self.root, self.cfg, self.args(dry_run=False)), 0)

        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertTrue(json.loads(output.call_args.args[0])["already_applied"])
        self.assertEqual(status_path.read_bytes(), fleet_module.status_bytes(state))

    def test_missing_journal_never_reports_already_applied(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        Path(state["amendments"][0]["journal"]).unlink()

        with patch("builtins.print") as output, self.assertRaisesRegex(FleetError, "journal is missing"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        output.assert_not_called()

    def test_conflicting_state_record_never_reports_already_applied(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        state["amendments"][0]["receipt"] = str(self.run_dir / "evidence" / "wrong.json")
        save_json(self.state_path, state)

        with patch("builtins.print") as output, self.assertRaisesRegex(FleetError, "state amendment record conflicts"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        output.assert_not_called()

    def test_corrupt_receipt_never_reports_already_applied(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        receipt_path = Path(state["amendments"][0]["receipt"])
        receipt_path.write_text("{corrupt\n", encoding="utf-8")

        with patch("builtins.print") as output, self.assertRaisesRegex(FleetError, "invalid JSON"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        output.assert_not_called()

    def test_content_mismatched_journal_never_reports_already_applied(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        journal_path = Path(state["amendments"][0]["journal"])
        journal = json.loads(journal_path.read_text(encoding="utf-8"))
        journal["expected_status"]["sha256"] = "0" * 64
        save_json(journal_path, journal)

        with patch("builtins.print") as output, self.assertRaisesRegex(FleetError, "journal receipt content identity conflicts"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        output.assert_not_called()

    def test_content_mismatched_receipt_never_reports_already_applied(self):
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        receipt_path = Path(state["amendments"][0]["receipt"])
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["state_after_sha256"] = "0" * 64
        save_json(receipt_path, receipt)

        with patch("builtins.print") as output, self.assertRaisesRegex(FleetError, "receipt content conflicts"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        output.assert_not_called()


class AttemptAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run_dir = self.root / "run"
        (self.run_dir / "evidence").mkdir(parents=True)
        self.state_path = self.run_dir / "state.json"

    def tearDown(self):
        self.temp.cleanup()

    def state(self, status: str) -> dict:
        task = task_state(
            "EXPR-001", "experience", "core", status, "trk-experience-expr-001", ["apps/web/**"]
        )
        return {
            "schema_version": 1,
            "run_id": "run_accept123",
            "objective": "accept test",
            "created_at": "2026-08-27T00:00:00Z",
            "updated_at": "2026-08-27T00:00:00Z",
            "run_dir": str(self.run_dir),
            "repo_selector": "id:repo_test",
            "coordinator_branch": "fleet-control-test",
            "initial_base_ref": "origin/main",
            "initial_base_sha": "0" * 40,
            "waves": [
                {
                    "id": "core",
                    "description": "core",
                    "depends_on": [],
                    "base": {"type": "ref", "value": "origin/main"},
                    "tasks": ["EXPR-001"],
                    "status": status,
                    "dispatched_at": task["dispatched_at"],
                    "completed_at": task["completed_at"],
                }
            ],
            "tasks": {"EXPR-001": task},
        }

    def args(self) -> argparse.Namespace:
        return argparse.Namespace(
            state=self.state_path,
            task="EXPR-001",
            branch=None,
            sha=None,
            outcome="failed",
            summary="Rejected by independent acceptance",
            retain=False,
            advance=False,
            dry_run=False,
            json=True,
        )

    def test_failed_attempt_cannot_be_reaccepted(self):
        save_json(self.state_path, self.state("failed"))
        with patch("fleet.settle_worker") as settle, self.assertRaisesRegex(FleetError, "failed task .* immutable"):
            do_accept(self.root, {}, self.args())
        settle.assert_not_called()

    def test_acceptance_evidence_is_attempt_unique(self):
        state = self.state("dispatched")
        state["tasks"]["EXPR-001"]["dispatch_id"] = "ctx_attempt123"
        save_json(self.state_path, state)
        expected = acceptance_evidence_path(state, "EXPR-001", "ctx_attempt123")
        with patch("fleet.settle_worker", return_value={"ok": True}), patch("builtins.print"):
            self.assertEqual(do_accept(self.root, {}, self.args()), 0)
        self.assertTrue(expected.exists())
        evidence = json.loads(expected.read_text(encoding="utf-8"))
        self.assertEqual(evidence["dispatch_id"], "ctx_attempt123")

    def test_existing_attempt_evidence_is_never_overwritten(self):
        state = self.state("dispatched")
        state["tasks"]["EXPR-001"]["dispatch_id"] = "ctx_attempt123"
        save_json(self.state_path, state)
        expected = acceptance_evidence_path(state, "EXPR-001", "ctx_attempt123")
        expected.write_text("preserve\n", encoding="utf-8")
        with patch("fleet.settle_worker") as settle, self.assertRaisesRegex(FleetError, "evidence already exists"):
            do_accept(self.root, {}, self.args())
        self.assertEqual(expected.read_text(encoding="utf-8"), "preserve\n")
        settle.assert_not_called()


class StateLockConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.run_dir = Path(self.temp.name) / "run"
        (self.run_dir / "evidence").mkdir(parents=True)
        self.state_path = self.run_dir / "state.json"
        left = task_state("LEFT-001", "data", "parallel", "dispatched", "trk-data-left-001", ["packages/db/**"])
        right = task_state("RIGHT-001", "data", "parallel", "dispatched", "trk-data-right-001", ["packages/db/**"])
        state = {
            "schema_version": 1,
            "run_id": "run_lock123",
            "objective": "lock test",
            "created_at": "2026-08-27T00:00:00Z",
            "updated_at": "2026-08-27T00:00:00Z",
            "run_dir": str(self.run_dir),
            "repo_selector": "id:repo_test",
            "coordinator_branch": "fleet-control-test",
            "initial_base_ref": "origin/main",
            "initial_base_sha": "0" * 40,
            "waves": [
                {
                    "id": "parallel",
                    "description": "parallel",
                    "depends_on": [],
                    "base": {"type": "ref", "value": "origin/main"},
                    "tasks": ["LEFT-001", "RIGHT-001"],
                    "status": "dispatched",
                    "dispatched_at": "2026-08-27T00:00:00Z",
                    "completed_at": None,
                }
            ],
            "tasks": {"LEFT-001": left, "RIGHT-001": right},
        }
        save_json(self.state_path, state)

    def tearDown(self):
        self.temp.cleanup()

    def args(self, task_id: str) -> argparse.Namespace:
        return argparse.Namespace(
            state=self.state_path,
            task=task_id,
            branch=None,
            sha=None,
            outcome="failed",
            summary=f"{task_id} rejected",
            retain=False,
            advance=False,
            dry_run=False,
            json=True,
        )

    def test_two_real_processes_cannot_lose_state_updates(self):
        context = multiprocessing.get_context("spawn")
        barrier = context.Barrier(2)
        results = context.Queue()
        processes = [
            context.Process(
                target=_accept_failed_process,
                args=(str(self.state_path), task_id, barrier, results),
            )
            for task_id in ("LEFT-001", "RIGHT-001")
        ]
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=20)
            self.assertFalse(process.is_alive(), "concurrent acceptance process did not exit")
            self.assertEqual(process.exitcode, 0)

        outcomes = dict(results.get(timeout=5) for _ in processes)
        self.assertEqual(outcomes, {"LEFT-001": "ok", "RIGHT-001": "ok"})
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["tasks"]["LEFT-001"]["status"], "failed")
        self.assertEqual(state["tasks"]["RIGHT-001"]["status"], "failed")
        self.assertEqual(len(list((self.run_dir / "evidence").glob("*-acceptance-*.json"))), 2)

    def test_bounded_lock_failure_precedes_every_mutation(self):
        context = multiprocessing.get_context("spawn")
        ready = context.Event()
        release = context.Event()
        holder = context.Process(target=_hold_state_lock_process, args=(str(self.state_path), ready, release))
        holder.start()
        self.assertTrue(ready.wait(timeout=10), "lock holder did not acquire the Run lock")
        before = self.state_path.read_bytes()
        try:
            with (
                patch.object(common_module, "STATE_LOCK_TIMEOUT_SECONDS", 0.05),
                patch("fleet.settle_worker") as settle,
                patch("fleet.orca") as orca,
                patch("fleet.save_state") as save_state,
                patch("fleet.save_json") as save_json_mock,
                self.assertRaisesRegex(FleetError, "timed out acquiring Run state lock"),
            ):
                do_accept(self.run_dir, {}, self.args("LEFT-001"))
        finally:
            release.set()
            holder.join(timeout=10)

        self.assertEqual(holder.exitcode, 0)
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertEqual(list((self.run_dir / "evidence").iterdir()), [])
        self.assertFalse((self.run_dir / "STATUS.md").exists())
        settle.assert_not_called()
        orca.assert_not_called()
        save_state.assert_not_called()
        save_json_mock.assert_not_called()


class ResolutionFinalizationTests(unittest.TestCase):
    setUp = AmendmentTests.setUp
    tearDown = AmendmentTests.tearDown
    amendment = AmendmentTests.amendment
    write_amendment = AmendmentTests.write_amendment
    args = AmendmentTests.args

    def apply_amendment(self) -> dict:
        with patch("builtins.print"):
            do_amend(self.root, self.cfg, self.args(dry_run=False))
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def finalize_args(self, allow_incomplete: bool = False) -> argparse.Namespace:
        return argparse.Namespace(state=self.state_path, allow_incomplete=allow_incomplete, json=True)

    def test_finalize_blocks_unresolved_failure_even_with_override(self):
        self.apply_amendment()
        with self.assertRaisesRegex(FleetError, "unresolved failures: EXPR-001"):
            do_finalize(self.finalize_args(allow_incomplete=True))

    def test_finalize_accepts_resolved_failure_with_replacement_sha(self):
        state = self.apply_amendment()
        replacement = state["tasks"]["EXPR-REPAIR-001"]
        replacement.update(
            {
                "status": "completed",
                "head_sha": "b" * 40,
                "branch": replacement["workspace_name"],
                "completed_at": "2026-08-27T03:00:00Z",
            }
        )
        integration = state["tasks"]["INT-001"]
        integration.update(
            {
                "status": "completed",
                "head_sha": "c" * 40,
                "branch": integration["workspace_name"],
                "completed_at": "2026-08-27T04:00:00Z",
            }
        )
        save_json(self.state_path, state)

        with patch("builtins.print"):
            self.assertEqual(do_finalize(self.finalize_args()), 0)

        manifest = json.loads((self.run_dir / "RELEASE_MANIFEST.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["tasks"]["EXPR-001"]["status"], "failed")
        self.assertEqual(manifest["tasks"]["EXPR-001"]["effective_status"], "resolved_failure")
        self.assertEqual(manifest["resolved_failures"][0]["replacement_sha"], "b" * 40)
        self.assertEqual(manifest["unresolved_failures"], [])
        markdown = status_markdown(state)
        self.assertIn("failed | resolved_failure", markdown)
        self.assertIn("superseded_by:EXPR-REPAIR-001@bbbbbbbbbbbb", markdown)

    def test_completed_replacement_without_sha_does_not_resolve_failure(self):
        state = self.apply_amendment()
        state["tasks"]["EXPR-REPAIR-001"]["status"] = "completed"
        state["tasks"]["EXPR-REPAIR-001"]["head_sha"] = None
        save_json(self.state_path, state)
        with self.assertRaisesRegex(FleetError, "unresolved failures: EXPR-001"):
            do_finalize(self.finalize_args())

    def test_finalize_requires_every_correction_to_have_an_accepted_sha(self):
        amendment = self.amendment()
        amendment["append_waves"][0]["tasks"].append(
            {
                "id": "DATA-CORR-001",
                "title": "Correct database baseline",
                "track": "data",
                "write_paths": ["packages/db/**"],
                "spec": "Apply the forward correction.",
            }
        )
        amendment["resolutions"].append({"task": "DATA-001", "corrected_by": "DATA-CORR-001"})
        self.write_amendment(amendment)
        state = self.apply_amendment()
        for task_id, sha in (("EXPR-REPAIR-001", "b" * 40), ("INT-001", "c" * 40)):
            state["tasks"][task_id].update(
                {
                    "status": "completed",
                    "head_sha": sha,
                    "branch": state["tasks"][task_id]["workspace_name"],
                    "completed_at": "2026-08-27T04:00:00Z",
                }
            )
        save_json(self.state_path, state)

        with self.assertRaisesRegex(FleetError, "accepted replacement SHA: DATA-001"):
            do_finalize(self.finalize_args(allow_incomplete=True))


if __name__ == "__main__":
    unittest.main()
