import hashlib
import unittest
from can_trace import inspect, parse_line, MAX_BYTES

class TraceTest(unittest.TestCase):
    def test_timestamp_precision_and_identifier_namespace(self):
        a = parse_line("(1700000000.123456789) can0 123#00FF")
        b = parse_line("(1700000000.123456) can0 00000123#")
        self.assertEqual(a.timestamp_ns,1700000000123456789)
        self.assertEqual(b.timestamp_ns,1700000000123456000)
        self.assertEqual(a.can_id,b.can_id)
        self.assertNotEqual(a.key,b.key)
        self.assertEqual(a.data,b"\x00\xff")
    def test_counts_and_original_digest(self):
        data = b"(1.000001) can0 123#AB\n(1.000002) can0 123#ABCD\n(1.000003) can0 00000123#\n"
        r = inspect(data)
        self.assertTrue(r["parseClean"])
        self.assertEqual(r["parsedFrames"],3)
        self.assertEqual(r["sha256"],hashlib.sha256(data).hexdigest())
        self.assertEqual(r["channels"][0]["payloadLengths"],{1:1,2:1})
        self.assertEqual(r["channels"][1]["canId"],"00000123")
        self.assertEqual(r["direction"],"unknown")
        self.assertEqual(r["captureCompleteness"],"not_verified")
    def test_invalid_frames_and_drop_marker_are_not_ignored(self):
        lines = ["(1.0) can0 800#00","(1.0) can0 20000000#00",
                 "(1.0) can0 123#0","(1.0) can0 123#R",
                 "(1.0) can0 123##100","DROPCOUNT: dropped 3",
                 "(1.0) can0 20000001#00","(1.0) can0 123#"+("00"*9)]
        data = ("(1.0) can0 123#00\n"+"\n".join(lines)).encode()
        r = inspect(data)
        self.assertFalse(r["parseClean"])
        self.assertEqual(r["parsedFrames"],1)
        self.assertEqual(sum(r["issues"].values()),len(lines))
    def test_non_monotonic_clock_separate_by_interface(self):
        r = inspect(b"(2.0) can0 123#00\n(1.0) can1 123#00\n(1.0) can0 123#00\n")
        self.assertEqual(r["issues"],{"NON_MONOTONIC_TIMESTAMP":1})
        self.assertFalse(r["parseClean"])
    def test_empty_bad_encoding_and_size(self):
        self.assertFalse(inspect(b"\n")["parseClean"])
        with self.assertRaises(ValueError): inspect(b"\xff")
        with self.assertRaises(ValueError): inspect(b"0"*(MAX_BYTES+1))
