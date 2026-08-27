import argparse
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from common import FleetError, save_json, sha256_file  # noqa: E402
from fleet import (  # noqa: E402
    acceptance_evidence_path,
    do_accept,
    do_amend,
    do_finalize,
    status_markdown,
)


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
