"""Inspect built APK security settings; optionally verify a pinned release signer.
No installation, publishing, signing, key creation or claims of product readiness.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

PACKAGE = "ru.traksos.minidiagnostic"
A = "{http://schemas.android.com/apk/res/android}"
ALLOWED_PERMISSIONS = {
    "android.permission.BLUETOOTH", "android.permission.BLUETOOTH_ADMIN",
    "android.permission.ACCESS_FINE_LOCATION", "android.permission.BLUETOOTH_SCAN",
    "android.permission.BLUETOOTH_CONNECT",
    PACKAGE + ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
}
COMPONENTS = {"activity", "activity-alias", "service", "receiver", "provider"}
CERT_LINE = re.compile(r"^Signer #([0-9]+) certificate SHA-256 digest: ([a-fA-F0-9]{64})$", re.M)

def inspect_manifest(xml):
    root = ET.fromstring(xml)
    errors = []
    if root.tag != "manifest" or root.get("package") != PACKAGE:
        errors.append("PACKAGE")
    app = root.find("application")
    if app is None:
        return errors + ["NO_APPLICATION"]
    for flag in ("debuggable", "testOnly"):
        if app.get(A + flag, "false") != "false":
            errors.append(flag)
    for flag in ("allowBackup", "fullBackupContent", "usesCleartextTraffic"):
        if app.get(A + flag) != "false":
            errors.append(flag)
    if not app.get(A + "dataExtractionRules"):
        errors.append("dataExtractionRules")
    sdk = root.find("uses-sdk")
    if sdk is None or sdk.get(A + "minSdkVersion") != "24" or sdk.get(A + "targetSdkVersion") != "35":
        errors.append("SDK_POLICY")
    for perm in root:
        if perm.tag not in ("uses-permission", "uses-permission-sdk-23", "uses-permission-sdk-m"):
            continue
        name = perm.get(A + "name", "")
        if name not in ALLOWED_PERMISSIONS:
            errors.append("UNEXPECTED_PERMISSION:" + name)
        if name in {"android.permission.BLUETOOTH", "android.permission.BLUETOOTH_ADMIN",
                    "android.permission.ACCESS_FINE_LOCATION"} and perm.get(A + "maxSdkVersion") != "30":
            errors.append("LEGACY_PERMISSION_SCOPE:" + name)
    exported = []
    for component in app:
        if component.tag not in COMPONENTS:
            continue
        name = component.get(A + "name", "")
        flag = component.get(A + "exported")
        # Require explicit non-exported for everything except the launcher.
        if flag not in ("true", "false"):
            errors.append("IMPLICIT_EXPORTED:" + name)
        if flag == "true":
            exported.append((component.tag, name))
        if component.get(A + "grantUriPermissions", "false") != "false":
            errors.append("URI_GRANTS:" + name)
        if component.find("grant-uri-permission") is not None:
            errors.append("URI_GRANTS:" + name)
    if len(exported) != 1 or exported[0][0] != "activity" or exported[0][1] not in (
            ".MainActivity", PACKAGE + ".MainActivity"):
        errors.append("EXPORTED_COMPONENTS")
    return errors

def verify_signer_output(output, expected):
    matches = CERT_LINE.findall(output)
    return (len(matches) == 1 and matches[0][0] == "1" and
            matches[0][1].lower() == expected.lower())

def find_sdk_tool(name):
    on_path = shutil.which(name)
    if on_path:
        return on_path
    root = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if not root:
        raise ValueError("ANDROID_SDK_NOT_FOUND")
    sdk = Path(root)
    candidates = ([sdk / "cmdline-tools/latest/bin" / name] +
                  sorted(sdk.glob("cmdline-tools/*/bin/" + name), reverse=True)
                  if name == "apkanalyzer" else
                  sorted(sdk.glob("build-tools/*/" + name), reverse=True))
    for path in candidates:
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    raise ValueError("SDK_TOOL_NOT_FOUND:" + name)

def run_tool(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
    if result.returncode != 0:
        raise ValueError("TOOL_FAILED:" + Path(args[0]).name + ":" + result.stderr[:500])
    return result.stdout

def file_sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def review(apk, expected=None):
    if not apk.is_file():
        raise ValueError("APK_NOT_FOUND")
    before = file_sha(apk)
    manifest = run_tool([find_sdk_tool("apkanalyzer"), "manifest", "print", str(apk)])
    errors = inspect_manifest(manifest)
    signed = False
    if expected:
        output = run_tool([find_sdk_tool("apksigner"), "verify", "--verbose", "--print-certs", str(apk)])
        signed = verify_signer_output(output, expected)
        if not signed:
            errors.append("SIGNER_MISMATCH")
    if file_sha(apk) != before:
        errors.append("APK_CHANGED")
    return {"schema": "traksos.apk-security-review.v1", "apk_sha256": before,
            "manifest_policy_passed": not any(e != "SIGNER_MISMATCH" for e in errors),
            "signature_checked": expected is not None, "pinned_signer_verified": signed,
            "findings": errors, "physical_diagnostics_ready": False,
            "publication_authorized": False}

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("apk", type=Path)
    p.add_argument("--expected-signer-sha256", help="Trusted certificate SHA-256, exactly 64 hex digits")
    p.add_argument("--output", type=Path)
    args = p.parse_args(argv)
    try:
        expected = args.expected_signer_sha256
        if expected is not None and not re.fullmatch(r"[A-Fa-f0-9]{64}", expected):
            raise ValueError("INVALID_CERTIFICATE_PIN")
        if args.output and args.output.resolve() == args.apk.resolve():
            raise ValueError("OUTPUT_EQUALS_APK")
        r = review(args.apk, expected)
        text = json.dumps(r, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            with args.output.open("x", encoding="utf-8") as out:
                out.write(text)
        else:
            sys.stdout.write(text)
        return 2 if r["findings"] else 0
    except (ValueError, OSError, ET.ParseError, subprocess.TimeoutExpired) as exc:
        print("APK review failed: " + str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
