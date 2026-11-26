import unittest
from bench_uds import identity_review, dtc_review

class BenchUdsTest(unittest.TestCase):
    def test_identity_missing_and_negative(self):
        result=identity_review(b"F187: 62 F1 87 31\nF18A: 7F 22 31\n")
        self.assertEqual(["supplier","hardware","software"],result["missing_fields"])
        self.assertFalse(result["electronic_identity_verified"])
        self.assertEqual("31",result["observed"]["F187"])

    def test_identity_invalid(self):
        for data in (b"F187: 62 F1 89 31",b"F187: 62 F1 87",
                     b"FFFF: 62 FF FF 31",b"F187: 62F18731\nF187: 62F18732",
                     b"F187: 7F 19 31",b"F187: 62F18731\n\nF189: 62F18931"):
            with self.subTest(data=data),self.assertRaises(ValueError):
                identity_review(data)

    def test_dtc_counts_and_masks(self):
        r=dtc_review(b"MASK: 49\nCOUNT: 590149FE0001\nLIST: 590249ABCDEF09")
        self.assertEqual(254,r["format_identifier"])
        self.assertTrue(r["counts_match"])
        self.assertFalse(r["physical_source_verified"])
        self.assertFalse(dtc_review(b"MASK: 49\nCOUNT: 590149030002\nLIST: 590249ABCDEF09")["counts_match"])
        self.assertTrue(dtc_review(b"MASK: 49\nCOUNT: 590149030000\nLIST: 590249")["counts_match"])

    def test_dtc_invalid(self):
        for data in (b"MASK: 01\nCOUNT: 590149030001\nLIST: 590249ABCDEF08",
                     b"MASK: 02\nCOUNT: 590149030000\nLIST: 590249",
                     b"MASK: 49\nCOUNT: 590149030002\nLIST: 590249ABCDEF09ABCDEF08",
                     b"MASK: 49\nCOUNT: 7F1978\nLIST: 590249",
                     b"MASK: 49\nCOUNT: 590149030001\nLIST: 590249ABCDEF",
                     b"MASK: 49\nCOUNT: 590149030001\nLIST: 5902FFABCDEF09",
                     b"MASK: 49\nMASK: 49\nLIST: 590249"):
            with self.subTest(data=data),self.assertRaises(ValueError):
                dtc_review(data)

if __name__=="__main__":
    unittest.main()
