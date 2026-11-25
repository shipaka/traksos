#!/usr/bin/env bash
# Run against the same isolated unsigned debug APK after existing runtime checks.
set -Eeuo pipefail
test -s apk-test/app-debug-androidTest.apk
adb install -r apk-test/app-debug-androidTest.apk
adb shell am instrument -w -r -e class ru.traksos.app.AppPinStoreTest \
  ru.traksos.app.preview.test/androidx.test.runner.AndroidJUnitRunner | tee pin-core-test.log
if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|shortMsg=|Process crashed' pin-core-test.log; then
  echo 'FAIL: native PIN core instrumentation failed' >&2
  exit 1
fi
grep -Eq '^OK \(11 tests?\)' pin-core-test.log
echo 'PASS: 11 native PIN core instrumentation tests'
