import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from worker_finish import valid_dispatch_id  # noqa: E402


class DispatchIdTests(unittest.TestCase):
    def test_current_context_id_is_valid(self):
        self.assertTrue(valid_dispatch_id("ctx_281af24e0d31"))

    def test_legacy_dispatch_id_is_valid(self):
        self.assertTrue(valid_dispatch_id("dispatch_abc123"))

    def test_effect_name_is_not_valid(self):
        self.assertFalse(valid_dispatch_id("dispatch_input"))


if __name__ == "__main__":
    unittest.main()
