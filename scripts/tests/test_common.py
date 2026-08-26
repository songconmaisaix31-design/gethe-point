import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from common import branch_context, path_matches, pattern_within, patterns_overlap, run, validate_plan  # noqa: E402


class SubprocessTests(unittest.TestCase):
    def test_invalid_utf8_output_is_replaced_instead_of_crashing(self):
        completed = run([sys.executable, "-c", "import os; os.write(1, bytes([255]))"])

        self.assertEqual(completed.stdout, "\ufffd")


class BranchContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))

    def test_orca_username_prefixed_worker_branch(self):
        self.assertEqual(
            branch_context(self.cfg, "songconmaisaix31-design/trk-web-web-001"),
            ("web", "web-001"),
        )

    def test_orca_username_prefixed_control_branch(self):
        self.assertEqual(
            branch_context(self.cfg, "songconmaisaix31-design/fleet-control-mvp"),
            ("control", None),
        )


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


class PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        cls.plan = json.loads((root / ".agents/plans/example.json").read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(validate_plan(self.plan, self.cfg), [])

    def test_parallel_overlap_is_rejected(self):
        plan = json.loads(json.dumps(self.plan))
        plan["waves"][1]["tasks"][1]["track"] = "web"
        plan["waves"][1]["tasks"][1]["write_paths"] = ["apps/web/src/**"]
        errors = validate_plan(plan, self.cfg)
        self.assertTrue(any("appears twice" in error or "overlap" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
