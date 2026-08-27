import json
import sys
import unittest
from itertools import combinations
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
            branch_context(self.cfg, "songconmaisaix31-design/trk-experience-expr-001"),
            ("experience", "expr-001"),
        )

    def test_orca_username_prefixed_control_branch(self):
        self.assertEqual(
            branch_context(self.cfg, "songconmaisaix31-design/fleet-control-mvp"),
            ("control", None),
        )


class PatternTests(unittest.TestCase):
    def test_directory_glob(self):
        self.assertTrue(path_matches("apps/web/src/components/App.tsx", "apps/web/src/components/**"))
        self.assertFalse(path_matches("modules/conversation/index.ts", "apps/web/src/components/**"))

    def test_containment(self):
        self.assertTrue(pattern_within("apps/web/src/components/**", "apps/web/src/components/**"))
        self.assertFalse(pattern_within("apps/web/src/**", "apps/web/src/components/**"))

    def test_overlap(self):
        self.assertTrue(patterns_overlap("apps/web/src/components/**", "apps/web/src/components/layout/**"))
        self.assertFalse(patterns_overlap("apps/web/src/components/**", "modules/conversation/**"))


class TrackOwnershipTests(unittest.TestCase):
    def test_track_allowlists_do_not_overlap(self):
        root = Path(__file__).resolve().parents[2]
        cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        overlaps = []
        for (left_name, left), (right_name, right) in combinations(cfg["tracks"].items(), 2):
            for left_pattern in left["allow"]:
                for right_pattern in right["allow"]:
                    if patterns_overlap(left_pattern, right_pattern):
                        overlaps.append(
                            f"{left_name}:{left_pattern} <-> {right_name}:{right_pattern}"
                        )

        self.assertEqual(overlaps, [])


class PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.cfg = json.loads((root / ".agents/fleet.json").read_text(encoding="utf-8"))
        cls.plan = json.loads((root / ".agents/plans/current.json").read_text(encoding="utf-8"))

    def test_active_plan_is_valid(self):
        self.assertEqual(validate_plan(self.plan, self.cfg), [])

    def test_example_plan_is_structurally_valid_and_launch_disabled(self):
        root = Path(__file__).resolve().parents[2]
        example = json.loads((root / ".agents/plans/example.json").read_text(encoding="utf-8"))

        self.assertEqual(validate_plan(example, self.cfg), [])
        self.assertFalse(example["launch_authorized"])

    def test_active_base_ref_is_consistent(self):
        self.assertEqual(self.plan["base_ref"], self.cfg["base_ref"])
        self.assertEqual(self.plan["waves"][0]["base"]["value"], self.cfg["base_ref"])

    def test_experience_track_owns_next_runtime_declaration(self):
        self.assertIn("apps/web/next-env.d.ts", self.cfg["tracks"]["experience"]["allow"])

    def test_foundation_owns_reproducible_root_gitignore(self):
        root = Path(__file__).resolve().parents[2]
        foundation = self.cfg["tracks"]["foundation"]
        found_task = self.plan["waves"][0]["tasks"][0]
        ignore_rules = (root / ".gitignore").read_text(encoding="utf-8").splitlines()

        self.assertIn(".gitignore", foundation["allow"])
        self.assertIn(".gitignore", found_task["write_paths"])
        self.assertIn("node_modules/", ignore_rules)
        self.assertIn("__pycache__/", ignore_rules)

    def test_workspace_suffix_rejects_unsafe_or_ambiguous_names(self):
        plan = json.loads(json.dumps(self.plan))
        plan["workspace_suffix"] = "Retry V2"

        errors = validate_plan(plan, self.cfg)

        self.assertTrue(any("workspace_suffix" in error for error in errors))

    def test_parallel_overlap_is_rejected(self):
        plan = json.loads(json.dumps(self.plan))
        parallel_wave = next(wave for wave in plan["waves"] if wave["id"] == "parallel-core")
        parallel_wave["tasks"][1]["track"] = "experience"
        parallel_wave["tasks"][1]["write_paths"] = ["apps/web/src/components/layout/**"]
        errors = validate_plan(plan, self.cfg)
        self.assertTrue(any("appears twice" in error or "overlap" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
