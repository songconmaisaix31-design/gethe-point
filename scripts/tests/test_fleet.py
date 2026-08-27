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
from fleet import dispatch_id_from_receipt, do_launch  # noqa: E402


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
