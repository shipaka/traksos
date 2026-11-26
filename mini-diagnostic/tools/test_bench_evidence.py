import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from bench_evidence import check, inventory, main

class BenchEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "capture"
        self.root.mkdir()
        self.kinds = {
            "trace.log": ("can_trace", b"(1.000001) can0 123#ABCD\n"),
            "identity.txt": ("identity_responses", b"example only\n"),
            "dtc.txt": ("dtc_responses", b"example only\n"),
            "reference.txt": ("reference_report", b"example only\n"),
            "notes.txt": ("notes", b"example only\n"),
        }
        for name, (_, data) in self.kinds.items():
            (self.root / name).write_bytes(data)
        self.m = {
            "schema":"traksos.bench-evidence.v1", "session_id":"test-01",
            "origin":"synthetic", "observed_at":"2026-11-26T12:00:00+03:00",
            "target_id":"test-target", "part_number":"TEST-PART", "hardware_version":"TEST-HW",
            "software_version":"TEST-SW", "reference_tool":"TEST-TOOL",
            "reference_tool_version":"TEST-VER", "interface":"ISO11898",
            "cable_id":"TEST-CABLE", "read_only":True, "isolated_stationary_bench":True,
            "source_reviewed_by_operator":True,
            "files":[dict(f,kind=self.kinds[f["name"]][0]) for f in inventory(self.root)],
        }
        self.write()

    def write(self):
        (self.root / "manifest.json").write_text(json.dumps(self.m), encoding="utf-8")

    def test_synthetic_never_ready(self):
        r=check(self.root)
        self.assertFalse(r["structurally_ready_for_manual_review"])
        self.assertIn("SYNTHETIC_NOT_PHYSICAL_EVIDENCE",r["findings"])
        self.assertFalse(r["physical_source_verified"])
        self.assertFalse(r["profile_approved"])
        self.assertFalse(r["active_diagnostics_authorized"])
        self.assertEqual(1,r["can_summaries"][0]["summary"]["parsedFrames"])

    def test_structure_not_authentication(self):
        # Test fixture changes a claim only, never represents actual bench evidence.
        self.m["origin"]="manual_bench"
        self.write()
        r=check(self.root)
        self.assertTrue(r["structurally_ready_for_manual_review"])
        self.assertFalse(r["physical_source_verified"])
        self.assertFalse(r["profile_approved"])

    def test_integrity_and_extra_files(self):
        (self.root/"trace.log").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError,"FILE_INTEGRITY"): check(self.root)
        (self.root/"trace.log").write_bytes(self.kinds["trace.log"][1])
        (self.root/"extra.txt").write_text("extra")
        with self.assertRaisesRegex(ValueError,"FILE_SET_MISMATCH"): check(self.root)

    def test_malformed_can_never_clean(self):
        self.m["origin"]="manual_bench"
        data=b"(1.0) can0 123#R\n"
        (self.root/"trace.log").write_bytes(data)
        row=next(r for r in self.m["files"] if r["name"]=="trace.log")
        row.update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
        self.write()
        self.assertIn("CAN_TRACE_NOT_CLEAN:trace.log",check(self.root)["findings"])

    def test_duplicate_json_and_unsafe_filename(self):
        (self.root/"manifest.json").write_text('{"schema":"x","schema":"y"}')
        with self.assertRaisesRegex(ValueError,"DUPLICATE_JSON_KEY"): check(self.root)
        self.m["files"][0]["name"]="../bad.txt"
        self.write()
        with self.assertRaisesRegex(ValueError,"FILE_KIND_OR_NAME"): check(self.root)

    def test_incomplete_metadata_and_no_output_inside(self):
        self.m["origin"]="manual_bench"
        self.m["software_version"]="unknown"
        self.m["read_only"]=False
        self.write()
        r=check(self.root)
        self.assertIn("METADATA_UNKNOWN:software_version",r["findings"])
        self.assertIn("DECLARATION_NOT_CONFIRMED:read_only",r["findings"])
        self.assertEqual(1,main(["check",str(self.root),"--output",str(self.root/"report.txt")]))
        self.assertFalse((self.root/"report.txt").exists())

    def test_symlink_rejected(self):
        target=Path(self.temp.name)/"outside.txt"
        target.write_text("outside")
        (self.root/"extra.txt").symlink_to(target)
        with self.assertRaisesRegex(ValueError,"NOT_REGULAR_FILE"): inventory(self.root)

if __name__=="__main__": unittest.main()
