import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from worker_finish import valid_dispatch_id, worker_done_payload  # noqa: E402


class DispatchIdTests(unittest.TestCase):
    def test_current_context_id_is_valid(self):
        self.assertTrue(valid_dispatch_id("ctx_281af24e0d31"))

    def test_legacy_dispatch_id_is_valid(self):
        self.assertTrue(valid_dispatch_id("dispatch_abc123"))

    def test_effect_name_is_not_valid(self):
        self.assertFalse(valid_dispatch_id("dispatch_input"))


class WorkerDonePayloadTests(unittest.TestCase):
    def test_payload_contains_only_non_secret_completion_fields(self):
        payload = worker_done_payload(
            "FOUND-001",
            "task_55e87d6abfcd",
            "ctx_281af24e0d31",
            "succeeded",
            "foundation",
            "trk-foundation-found-001-v2",
            "a" * 40,
            "verified",
            ["package.json"],
        )

        self.assertEqual(payload["dispatch_id"], "ctx_281af24e0d31")
        self.assertNotIn("dispatch_capability", payload)
        self.assertEqual(payload["files_modified"], "package.json")


if __name__ == "__main__":
    unittest.main()
