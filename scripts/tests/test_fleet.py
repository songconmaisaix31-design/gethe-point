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
from fleet import do_launch  # noqa: E402


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
