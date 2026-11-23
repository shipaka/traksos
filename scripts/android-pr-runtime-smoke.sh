#!/usr/bin/env bash
# Runs INSIDE reactivecircus/android-emulator-runner as a single shell command.
# The action invokes each script line individually; loops must live in this file.
# All output is non-sensitive: readiness tags, screenshot, foreground state, crash log.
set -Eeuo pipefail

# Android 15 emulators can lose the adb transport *after* an app has already
# launched. A bare adb exec-out/cat then blocks until GitHub cancels the whole
# 35-minute job. Bound every direct adb subprocess and FAIL CLOSED instead:
# no PASS without fresh screenshots, UI hierarchy and a responsive device.
ADB_BIN="$(command -v adb)"
adb() {
  timeout --signal=TERM --kill-after=5s 35s "$ADB_BIN" "$@"
}

# Some API 35 GitHub emulator images sporadically show an ANR for their
# SYSTEM Pixel Launcher over a correctly rendered TrakSOS WebView.
# Dismiss ONLY that exact launcher dialog via its real accessibility bounds.
# Never dismiss TrakSOS or any other application's ANR, and still demand
# an actual painted role-specific UI afterwards.
dismiss_pixel_launcher_anr() {
  local hierarchy="$1" point
  if ! grep -Fq "Pixel Launcher isn't responding" "$hierarchy"; then return 1; fi
  point="$(python3 - "$hierarchy" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
    for node in root.iter('node'):
        if node.get('text') == 'Wait' and node.get('class') == 'android.widget.Button':
            bounds = node.get('bounds', '')
            match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
            if match:
                left, top, right, bottom = map(int, match.groups())
                print((left + right) // 2, (top + bottom) // 2)
                break
except (OSError, ValueError, ET.ParseError):
    pass
PY
)"
  if [ -z "$point" ]; then
    echo "FAIL: Pixel Launcher ANR has no accessible Wait button"
    return 1
  fi
  echo "INFO: dismissing SYSTEM Pixel Launcher ANR, not a TrakSOS crash"
  adb shell input tap $point
  echo "SYSTEM_PIXEL_LAUNCHER_ANR_DISMISSED=1" >> runtime-ready.log
  sleep 3
}

apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity

ready=0
: > runtime-ready.log
for attempt in $(seq 1 75); do
  adb logcat -d -s TrakSOSRuntime:I > runtime-ready.log
  if grep -Fq 'GUEST_UI_RENDERED' runtime-ready.log &&
     grep -Fq 'SPLASH_VISIBLE_MS=' runtime-ready.log; then
    ready=1
    break
  fi
  sleep 2
done

# Capture artifacts even on failure. Native app still gets a strict error gate.
adb logcat -d -s AndroidRuntime:E > runtime-errors.log || true
adb shell dumpsys activity activities > activity-dump.txt || true
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
if timeout 30s adb shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if timeout 30s adb shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
    adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
  fi
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || screen_ok=0
fi
if [ "$screen_ok" -ne 1 ]; then
  echo 'FAIL: screenshot did not show a visibly rendered TrakSOS guest page'
  exit 1
fi
if [ -s emulator-ui.xml ] && grep -Eiq "Pixel Launcher isn.t responding|System UI isn.t responding|TrakSOS isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android system dialog still covers TrakSOS'
  exit 1
fi
if [ "$ready" -ne 1 ]; then
  echo 'FAIL: real React guest interface and splash dismissal not both observed'
  tail -n 30 runtime-ready.log
  exit 1
fi

visible_ms=$(sed -n 's/.*SPLASH_VISIBLE_MS=\([0-9][0-9]*\).*/\1/p' runtime-ready.log | tail -1)
if [ -z "$visible_ms" ] || [ "$visible_ms" -lt 3500 ]; then
  echo "FAIL: seasonal startup only ${visible_ms:-unknown}ms; expected >= 3500ms"
  exit 1
fi
adb shell pidof ru.traksos.app.preview
if grep -F 'Process: ru.traksos.app.preview' runtime-errors.log; then
  echo 'FAIL: native app crash observed'
  exit 1
fi
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Clear them before each role so an earlier render cannot falsely pass.
  adb logcat -c
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    if adb logcat -d -s TrakSOSRuntime:I | grep -Fq "DESIGN_REVIEW_RENDERED=$role"; then
      found=1
      break
    fi
    sleep 1
  done
  if [ "$found" -ne 1 ]; then
    echo "FAIL: installed APK did not render Android design review role=$role"
    exit 1
  fi

  # A React callback alone does not prove the requested screen is PAINTED:
  # Android 15 previously captured the guest page under the filename
  # android-review-client.png, and the client under android-review-master.png.
  # Allow the compositor to paint, then validate the visible native UI.
  sleep 3
  # Collect actual pixels BEFORE UIAutomator: API35 can fail to write its
  # accessibility XML although the React role was rendered. Preserve the
  # screenshot for independent QA even when this strict gate still fails.
  adb exec-out screencap -p > "android-review-$role.png" || true
  painted=0
  for attempt in 1 2 3 4 5; do
    if [ "$sdk_level" -ge 34 ]; then
      # Dump accessibility BEFORE capturing. Waiting for the dump can advance
      # the compositor several frames past the guest or previous role.
      if ! timeout 25s adb shell uiautomator dump /sdcard/traksos-role.xml >/dev/null 2>&1 ||
         ! adb exec-out cat /sdcard/traksos-role.xml > "android-review-$role-ui.xml"; then
        sleep 2
        continue
      fi
      # API 35 sometimes wedges the emulator Pixel Launcher, not TrakSOS.
      # Retry the screenshot ONLY after dismissing that specific system dialog.
      if grep -Fq "Pixel Launcher isn't responding" "android-review-$role-ui.xml"; then
        dismiss_pixel_launcher_anr "android-review-$role-ui.xml" || exit 1
        continue
      fi
      marker='Владелец автопарка'
      if [ "$role" = master ]; then marker='Сегодня'; fi
      if ! grep -Fq 'Рабочий стол' "android-review-$role-ui.xml" ||
         ! grep -Fq "$marker" "android-review-$role-ui.xml"; then
        sleep 2
        continue
      fi
    fi
    adb exec-out screencap -p > "android-review-$role.png"
    previous=(emulator-screen.png)
    if [ "$role" = master ]; then previous+=(android-review-client.png); fi
    if python3 scripts/verify-android-screen.py "android-review-$role.png" "${previous[@]}"; then
      painted=1
      break
    fi
    sleep 3
  done
  if [ "$painted" -ne 1 ]; then
    adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
    # This is diagnostic only; no relaxed PASS without real accessibility +
    # screenshot evidence. A missing XML will no longer hide the actual pixels.
    if [ -s "android-review-$role.png" ]; then
      python3 scripts/verify-android-screen.py "android-review-$role.png" emulator-screen.png || true
    fi
    echo "FAIL: native Android $sdk_level did not visibly display expected role=$role after React render"
    exit 1
  fi
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
adb logcat -d -s AndroidRuntime:E >> runtime-errors.log || true
if grep -F 'Process: ru.traksos.app.preview' runtime-errors.log; then
  echo 'FAIL: native app crash during review'
  exit 1
fi
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no native crash or ANR"
