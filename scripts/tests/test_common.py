import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from common import (  # noqa: E402
    branch_context,
    branch_matches_workspace,
    path_matches,
    pattern_within,
    patterns_overlap,
    run,
    validate_plan,
)


class SubprocessTests(unittest.TestCase):
    def test_invalid_utf8_output_is_replaced_instead_of_crashing(self):
        completed = run([sys.executable, "-c", "import os; os.write(1, bytes([255]))"])

        self.assertEqual(completed.stdout, "\ufffd")


class PatternTests(unittest.TestCase):
    def test_directory_glob(self):
        self.assertTrue(path_matches("apps/web/src/App.tsx", "apps/web/**"))
        self.assertFalse(path_matches("services/api/app.py", "apps/web/**"))

    def test_containment(self):
        self.assertTrue(pattern_within("apps/web/src/**", "apps/web/**"))
        self.assertFalse(pattern_within("apps/**", "apps/web/**"))

    def test_overlap(self):
        self.assertTrue(patterns_overlap("apps/web/**", "apps/web/src/**"))
        self.assertFalse(patterns_overlap("apps/web/**", "services/api/**"))

    def test_attempt_scoped_branch_identity(self):
        root = Path(__file__).resolve().parents[2]
        cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        self.assertEqual(
            branch_context(cfg, "trk-conversation-conv-001--run-abc-a2"),
            ("conversation", "conv-001"),
        )

    def test_orca_owner_prefixed_branch_identity(self):
        root = Path(__file__).resolve().parents[2]
        cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        self.assertEqual(
            branch_context(cfg, "songconmaisaix31-design/trk-conversation-conv-001--run-abc-a2"),
            ("conversation", "conv-001"),
        )
        self.assertEqual(
            branch_context(cfg, "songconmaisaix31-design/fleet-control-mvp"),
            ("control", None),
        )

    def test_workspace_match_allows_one_owner_prefix_only(self):
        workspace = "trk-conversation-conv-001--run-abc-a2"

        self.assertTrue(branch_matches_workspace(workspace, workspace))
        self.assertTrue(branch_matches_workspace(f"owner/{workspace}", workspace))
        self.assertFalse(branch_matches_workspace(f"owner/nested/{workspace}", workspace))
        self.assertFalse(branch_matches_workspace(f"other-{workspace}", workspace))


class PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        cls.plan = json.loads((root / ".agents/plans/example.json").read_text(encoding="utf-8"))
        cls.current_plan = json.loads((root / ".agents/plans/current.json").read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(validate_plan(self.plan, self.cfg), [])

    def test_current_plan_is_valid_and_launch_blocked(self):
        self.assertEqual(validate_plan(self.current_plan, self.cfg), [])
        self.assertEqual(self.current_plan["plan_status"], "draft")
        self.assertFalse(self.current_plan["launch_authorized"])
        self.assertEqual(self.current_plan["base_ref"], "BLOCKED_UNTIL_KIT_IS_IN_SHARED_BASE")

    def test_current_plan_encodes_product_and_deterministic_boundaries(self):
        agent_ids = {agent["id"] for agent in self.current_plan["product_agent_boundaries"]}
        self.assertEqual(agent_ids, {"witness", "responsibility", "handover", "boundary"})
        self.assertEqual(self.current_plan["deterministic_boundaries"]["care_escalation"]["llm_calls"], "forbidden")
        self.assertEqual(
            self.current_plan["deterministic_boundaries"]["report_renderer"],
            {"mode": "human-authored-template-substitution", "llm_calls": "forbidden"},
        )

    def test_database_migration_is_the_first_task(self):
        first_wave = self.current_plan["waves"][0]
        first_task = first_wave["tasks"][0]

        self.assertEqual(first_wave["id"], "database-foundation")
        self.assertEqual(first_task["id"], "DATA-001")
        self.assertEqual(set(first_task["write_paths"]), {"packages/db/**", "supabase/**"})
        self.assertIn("discoveredBy", first_task["spec"])
        self.assertIn("DATA-001", self.current_plan["waves"][1]["depends_on"])

    def test_parallel_overlap_is_rejected(self):
        plan = json.loads(json.dumps(self.plan))
        plan["waves"][1]["tasks"][1]["track"] = "experience"
        plan["waves"][1]["tasks"][1]["write_paths"] = ["apps/web/src/modules/home/subview/**"]
        errors = validate_plan(plan, self.cfg)
        self.assertTrue(any("appears twice" in error or "overlap" in error for error in errors))

    def test_task_cannot_downgrade_worktree_mode(self):
        plan = json.loads(json.dumps(self.plan))
        plan["waves"][0]["tasks"][0]["worktree_mode"] = "reuse"
        errors = validate_plan(plan, self.cfg)
        self.assertTrue(any("worktree_mode must be new-top-level" in error for error in errors))

    def test_completion_task_must_cover_every_task(self):
        plan = json.loads(json.dumps(self.plan))
        plan["waves"][-1]["depends_on"].remove("CONV-900")
        errors = validate_plan(plan, self.cfg)
        self.assertTrue(any("does not transitively depend on every task" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
