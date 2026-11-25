#!/usr/bin/env bash
# Run against the same isolated unsigned debug APK after existing runtime checks.
set -Eeuo pipefail
expected=12
test -s apk-test/app-debug-androidTest.apk
adb install -r apk-test/app-debug-androidTest.apk
adb shell am instrument -w -r -e class ru.traksos.app.AppPinStoreTest \
  ru.traksos.app.preview.test/androidx.test.runner.AndroidJUnitRunner | tee pin-core-test.log
if grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|shortMsg=|Process crashed|INSTRUMENTATION_STATUS_CODE: -[0-9]+' pin-core-test.log; then
  echo 'FAIL: native PIN core instrumentation failed' >&2
  exit 1
fi
# AndroidJUnitRunner reports -1 on successful completion. Require the exact
# expected number of completed tests, not merely the final OK summary.
tr -d '\r' < pin-core-test.log > pin-core-test.normalized.log
if ! grep -qx "OK ($expected tests)" pin-core-test.normalized.log ||
   ! grep -qx 'INSTRUMENTATION_CODE: -1' pin-core-test.normalized.log ||
   [[ $(grep -cx 'INSTRUMENTATION_STATUS_CODE: 0' pin-core-test.normalized.log || true) != "$expected" ]]; then
  echo "FAIL: expected $expected successful native PIN tests and final runner completion" >&2
  exit 1
fi
echo "PASS: $expected native PIN core instrumentation tests"
