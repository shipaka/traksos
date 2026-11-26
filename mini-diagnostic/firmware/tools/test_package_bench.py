import struct
import unittest
from package_bench import verify_layout, OFFSETS
def parts():
    table = struct.pack("<HBBII16sI",0x50aa,0,0,0x10000,0x100000,b"factory",0)
    return list(zip(OFFSETS,[b"\xe9boot",table,b"ota",b"\xe9app"]))
class LayoutTest(unittest.TestCase):
    def test_layout(self):
        verify_layout(parts())
    def test_overlap(self):
        p=parts(); p[0]=(0x1000,b"\xe9"*0x7001)
        with self.assertRaises(ValueError): verify_layout(p)
    def test_wrong_app_offset(self):
        p=parts(); p[3]=(0x20000,p[3][1])
        with self.assertRaises(ValueError): verify_layout(p)
    def test_wrong_partition(self):
        p=parts(); p[1]=(0x8000,b"invalid")
        with self.assertRaises(ValueError): verify_layout(p)
