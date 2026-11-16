#!/usr/bin/env bash
# Run after the normal visual/runtime smoke in Android emulator CI.
# These tests run only inside the isolated debug APK and never use a live account.
set -Eeuo pipefail
test_apk="apk-test/app-debug-androidTest.apk"
test -s "$test_apk"
adb install -r "$test_apk"
adb shell am instrument -w -r   ru.traksos.app.preview.test/androidx.test.runner.AndroidJUnitRunner |
  tee pin-test.log
if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|shortMsg=|Process crashed' pin-test.log; then
  echo "FAIL: Android PIN instrumentation signalled a failure"
  exit 1
fi
if ! grep -Eq '^OK \([0-9]+ tests?\)' pin-test.log; then
  echo "FAIL: no successful AndroidKeystore PIN tests reported"
  exit 1
fi
echo "PASS: native PIN/Keystore tests ran on Android emulator"
