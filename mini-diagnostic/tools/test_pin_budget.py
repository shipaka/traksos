"""Check consistency of the proposed review-only allocation, not electrical safety."""
import json
import pathlib
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
class PinBudgetTest(unittest.TestCase):
    def test_review_only_and_gpio_constraints(self):
        data=json.loads((ROOT/"hardware/pin-budget-review.json").read_text())
        self.assertEqual(data["status"],"REVIEW_ONLY_NOT_WIRING")
        pins=data["pins"]
        numbers=[p["gpio"] for p in pins]
        self.assertEqual(len(numbers),len(set(numbers)))
        self.assertEqual(len(pins),len({p["role"] for p in pins}))
        self.assertFalse(set(numbers)&set(data["reserved"]))
        self.assertEqual(set(numbers),{4,13,14,16,17,18,19,21,22,23,25,26,27,32,33,35,36,39})
        for p in pins:
            self.assertIn(p["direction"],{"in","out"})
            if p["gpio"] in {34,35,36,39}:
                self.assertEqual(p["direction"],"in")
        self.assertEqual({p["gpio"] for p in pins if p["role"].startswith("LIGHT_")},{18,19,25,26,27,32,33})
        roles={p["role"]:p["gpio"] for p in pins}
        self.assertEqual((roles["TWAI_TX"],roles["TWAI_RX"]),(22,21))
        self.assertIn("No individual feedback for seven light channels allocated",data["limitations"])
