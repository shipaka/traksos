"""Offline evidence-folder review. No hardware access, active bus requests, or profile activation."""
import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path
from datetime import datetime
from can_trace import inspect, MAX_BYTES
from bench_uds import identity_review, dtc_review

SCHEMA = "traksos.bench-evidence.v1"
MAX_MANIFEST = 64 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_FILES = 24
ALLOWED = {
    "can_trace": ".log",
    "identity_responses": ".txt",
    "dtc_responses": ".txt",
    "reference_report": ".txt",
    "notes": ".txt",
    "label_photo": ".jpg",
}
NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.(?:log|txt|jpg)", re.ASCII)
SHA = re.compile(r"[0-9a-f]{64}", re.ASCII)
ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}", re.ASCII)
ROOT_FIELDS = {
    "schema", "session_id", "origin", "observed_at", "target_id", "part_number",
    "hardware_version", "software_version", "reference_tool", "reference_tool_version",
    "interface", "cable_id", "read_only", "isolated_stationary_bench",
    "source_reviewed_by_operator", "files",
}
PATHS = {"ISO11992", "ISO11898", "K_LINE", "UNKNOWN"}

def reject(reason):
    raise ValueError(reason)

def read_regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        reject("NOT_REGULAR_FILE")
    if info.st_size > limit:
        reject("FILE_LIMIT")
    with path.open("rb") as src:
        data = src.read(limit + 1)
    if len(data) > limit:
        reject("FILE_LIMIT")
    return data

def strict_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            reject("DUPLICATE_JSON_KEY")
        out[key] = value
    return out

def string(obj, key, maximum=120):
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        reject("FIELD_" + key)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        reject("FIELD_" + key)
    return value

def directory(root):
    if root.is_symlink() or not root.is_dir():
        reject("INVALID_DIRECTORY")
    return root

def inventory(root):
    root = directory(root)
    files = []
    total = 0
    for path in sorted(root.iterdir()):
        if path.name == "manifest.json":
            continue
        if not NAME.fullmatch(path.name):
            reject("INVALID_FILENAME")
        if len(files) >= MAX_FILES:
            reject("FILE_COUNT")
        data = read_regular(path, MAX_BYTES)
        total += len(data)
        if total > MAX_TOTAL:
            reject("TOTAL_LIMIT")
        files.append({"name": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return files

def check(root, uds_review=False):
    root = directory(root)
    raw = read_regular(root / "manifest.json", MAX_MANIFEST)
    m = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object,
                   parse_constant=lambda _: reject("INVALID_JSON_CONSTANT"))
    if not isinstance(m, dict) or set(m) != ROOT_FIELDS or m["schema"] != SCHEMA:
        reject("MANIFEST_SCHEMA")
    for key in ("session_id", "target_id"):
        if not ID.fullmatch(string(m, key, 64)):
            reject("FIELD_" + key)
    if m["origin"] not in ("synthetic", "manual_bench"):
        reject("FIELD_origin")
    if m["interface"] not in PATHS:
        reject("FIELD_interface")
    observed = string(m, "observed_at")
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})", observed):
        reject("FIELD_observed_at")
    try:
        ts = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            reject("FIELD_observed_at")
    except ValueError:
        reject("FIELD_observed_at")
    for key in ("part_number", "hardware_version", "software_version", "reference_tool",
                "reference_tool_version", "cable_id"):
        string(m, key)
    for key in ("read_only", "isolated_stationary_bench", "source_reviewed_by_operator"):
        if type(m[key]) is not bool:
            reject("FIELD_" + key)
    if not isinstance(m["files"], list) or not 1 <= len(m["files"]) <= MAX_FILES:
        reject("FILE_COUNT")
    expected = {}
    kinds = set()
    for row in m["files"]:
        if not isinstance(row, dict) or set(row) != {"name", "kind", "bytes", "sha256"}:
            reject("FILE_SCHEMA")
        name = string(row, "name", 70)
        kind = string(row, "kind")
        if not NAME.fullmatch(name) or kind not in ALLOWED or not name.endswith(ALLOWED[kind]):
            reject("FILE_KIND_OR_NAME")
        if name.casefold() in {n.casefold() for n in expected}:
            reject("DUPLICATE_FILENAME")
        if type(row["bytes"]) is not int or not 1 <= row["bytes"] <= MAX_BYTES:
            reject("FILE_SIZE")
        if not isinstance(row["sha256"], str) or not SHA.fullmatch(row["sha256"]):
            reject("FILE_SHA")
        expected[name] = row
        kinds.add(kind)
    actual = inventory(root)
    if set(expected) != {f["name"] for f in actual}:
        reject("FILE_SET_MISMATCH")
    summaries = []
    findings = []
    uds_summaries = []
    uds_kinds = set()
    for f in actual:
        row = expected[f["name"]]
        if f["sha256"] != row["sha256"] or f["bytes"] != row["bytes"]:
            reject("FILE_INTEGRITY")
        # Recheck when reading again for interpretation.
        data = read_regular(root / row["name"], MAX_BYTES)
        if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
            reject("FILE_CHANGED")
        if row["kind"] == "can_trace":
            try:
                report = inspect(data)
                summaries.append({"name": row["name"], "summary": report})
                if not report["parseClean"]:
                    findings.append("CAN_TRACE_NOT_CLEAN:" + row["name"])
            except ValueError as exc:
                findings.append("CAN_TRACE_REJECTED:" + row["name"] + ":" + str(exc))
        elif uds_review and row["kind"] in ("identity_responses", "dtc_responses"):
            kind = row["kind"]
            if kind in uds_kinds:
                findings.append("UDS_DUPLICATE_KIND:" + kind)
            uds_kinds.add(kind)
            try:
                summary = identity_review(data) if kind == "identity_responses" else dtc_review(data)
                uds_summaries.append({"name": row["name"], "summary": summary})
                if kind == "identity_responses" and summary["missing_fields"]:
                    findings.append("UDS_IDENTITY_INCOMPLETE:" + row["name"])
                if kind == "dtc_responses" and not summary["counts_match"]:
                    findings.append("UDS_COUNT_LIST_DIFFER:" + row["name"])
            except ValueError as exc:
                findings.append("UDS_REJECTED:" + row["name"] + ":" + str(exc))
        elif row["kind"] != "label_photo":
            try:
                txt = data.decode("utf-8")
                if not txt.strip() or "\x00" in txt:
                    findings.append("TEXT_INVALID:" + row["name"])
            except UnicodeDecodeError:
                findings.append("TEXT_INVALID:" + row["name"])
    if m["origin"] == "synthetic":
        findings.append("SYNTHETIC_NOT_PHYSICAL_EVIDENCE")
    for key in ("read_only", "isolated_stationary_bench", "source_reviewed_by_operator"):
        if not m[key]:
            findings.append("DECLARATION_NOT_CONFIRMED:" + key)
    if m["interface"] == "UNKNOWN":
        findings.append("INTERFACE_UNKNOWN")
    if m["interface"] in ("ISO11992", "ISO11898") and "can_trace" not in kinds:
        findings.append("CAN_TRACE_MISSING")
    for key in ("part_number", "hardware_version", "software_version", "reference_tool",
                "reference_tool_version", "cable_id"):
        if m[key].strip().casefold() in ("unknown", "неизвестно", "n/a", "-", "tbd", "pending"):
            findings.append("METADATA_UNKNOWN:" + key)
    for kind in ("identity_responses", "dtc_responses", "reference_report", "notes"):
        if kind not in kinds:
            findings.append("MISSING_KIND:" + kind)
    return {
        "schema": "traksos.bench-evidence-review.v1",
        "session_id": m["session_id"],
        "origin": m["origin"],
        "manifest_sha256": hashlib.sha256(raw).hexdigest(),
        "files": actual,
        "can_summaries": summaries,
        "uds_review_requested": uds_review,
        "uds_summaries": uds_summaries,
        "findings": findings,
        "structurally_ready_for_manual_review": not findings,
        "physical_source_verified": False,
        "profile_approved": False,
        "active_diagnostics_authorized": False,
    }

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=("inventory", "check"))
    p.add_argument("folder", type=Path)
    p.add_argument("--output", type=Path)
    p.add_argument("--uds-review", action="store_true", help="Explicitly check strict complete UDS identity and count/list PDU files")
    a = p.parse_args(argv)
    try:
        root = directory(a.folder)
        if a.output and (a.output.resolve() == root.resolve() or root.resolve() in a.output.resolve().parents):
            reject("OUTPUT_MUST_BE_OUTSIDE_EVIDENCE_FOLDER")
        if a.uds_review and a.action != "check":
            reject("UDS_REVIEW_REQUIRES_CHECK")
        result = inventory(root) if a.action == "inventory" else check(root, uds_review=a.uds_review)
        report = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if a.output:
            with a.output.open("x", encoding="utf-8") as dst:
                dst.write(report)
        else:
            sys.stdout.write(report)
        return 2 if a.action == "check" and not result["structurally_ready_for_manual_review"] else 0
    except (OSError, ValueError, RecursionError, TypeError) as exc:
        print("Evidence rejected: " + str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
