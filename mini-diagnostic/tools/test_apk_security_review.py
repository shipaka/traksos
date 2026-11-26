import unittest
from apk_security_review import inspect_manifest, verify_signer_output

BASE = """<manifest xmlns:android="http://schemas.android.com/apk/res/android"
 package="ru.traksos.minidiagnostic">
 <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35"/>
 <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
 <application android:allowBackup="false" android:fullBackupContent="false"
 android:usesCleartextTraffic="false" android:dataExtractionRules="@xml/data_extraction_rules">
 <activity android:name=".MainActivity" android:exported="true"/>
 <provider android:name="androidx.startup.InitializationProvider" android:exported="false"/>
 </application></manifest>"""

class ApkReviewTest(unittest.TestCase):
    def test_expected_manifest(self):
        self.assertEqual([], inspect_manifest(BASE))
    def test_debug_backup_and_export(self):
        self.assertIn("debuggable", inspect_manifest(BASE.replace("<application ", '<application android:debuggable="true" ')))
        self.assertIn("allowBackup", inspect_manifest(BASE.replace('allowBackup="false"', 'allowBackup="true"')))
        self.assertIn("EXPORTED_COMPONENTS", inspect_manifest(BASE.replace('android:exported="false"', 'android:exported="true"')))
        self.assertTrue(any(e.startswith("IMPLICIT_EXPORTED:") for e in inspect_manifest(BASE.replace(' android:exported="false"', ""))))
    def test_unexpected_permission_and_sdk(self):
        self.assertIn("UNEXPECTED_PERMISSION:android.permission.INTERNET", inspect_manifest(BASE.replace("BLUETOOTH_CONNECT", "INTERNET")))
        self.assertIn("SDK_POLICY", inspect_manifest(BASE.replace('targetSdkVersion="35"', 'targetSdkVersion="34"')))
        self.assertIn("LEGACY_PERMISSION_SCOPE:android.permission.BLUETOOTH", inspect_manifest(BASE.replace("BLUETOOTH_CONNECT", "BLUETOOTH")))
    def test_exact_one_trusted_signer(self):
        pin = "a"*64
        line = "Signer #1 certificate SHA-256 digest: " + pin
        self.assertTrue(verify_signer_output(line, pin.upper()))
        self.assertFalse(verify_signer_output(line, "b"*64))
        self.assertFalse(verify_signer_output(line+"\nSigner #2 certificate SHA-256 digest: "+pin, pin))
        self.assertFalse(verify_signer_output("certificate not verified", pin))

if __name__ == "__main__":
    unittest.main()
