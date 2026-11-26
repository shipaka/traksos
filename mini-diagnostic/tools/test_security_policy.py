"""Static baseline checks; not a substitute for signed release or device testing."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"

class SecurityPolicyTest(unittest.TestCase):
    def test_manifest_minimal_surface(self):
        manifest = ET.parse(ROOT / "app/src/main/AndroidManifest.xml").getroot()
        app = manifest.find("application")
        self.assertIsNotNone(app)
        self.assertEqual("false", app.attrib[ANDROID+"allowBackup"])
        self.assertEqual("false", app.attrib[ANDROID+"fullBackupContent"])
        self.assertEqual("false", app.attrib[ANDROID+"usesCleartextTraffic"])
        self.assertEqual("@xml/data_extraction_rules", app.attrib[ANDROID+"dataExtractionRules"])
        permissions = {p.attrib[ANDROID+"name"] for p in manifest.findall("uses-permission")}
        self.assertNotIn("android.permission.INTERNET", permissions)
        self.assertNotIn("android.permission.MANAGE_EXTERNAL_STORAGE", permissions)
        for component in app:
            if component.tag in ("activity","activity-alias","service","receiver","provider"):
                if component.attrib.get(ANDROID+"exported") == "true":
                    self.assertEqual(".MainActivity", component.attrib[ANDROID+"name"])
                    self.assertEqual("activity", component.tag)
    def test_backup_exclusions(self):
        rules = ET.parse(ROOT / "app/src/main/res/xml/data_extraction_rules.xml").getroot()
        domains = {"root","file","database","sharedpref","external","device_root",
                   "device_file","device_database","device_sharedpref"}
        for kind in ("cloud-backup","device-transfer"):
            self.assertEqual(domains,{e.attrib["domain"] for e in rules.find(kind).findall("exclude") if e.attrib["path"]=="."})
    def test_release_defaults(self):
        gradle = (ROOT / "app/build.gradle.kts").read_text()
        for setting in ("isDebuggable = false","isMinifyEnabled = true","isShrinkResources = true",
                        "TRAKSOS_MINI_KEYSTORE","Incomplete Mini Diagnostic release signing environment"):
            self.assertIn(setting,gradle)
        self.assertNotIn('signingConfigs.getByName("debug")',gradle)

if __name__ == "__main__":
    unittest.main()
