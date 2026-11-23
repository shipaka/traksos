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
  # Android 15's headless emulator can render the React review event via an
  # onNewIntent/same-document WebView navigation but keep a stale GUEST
  # compositor frame. Cold launch the *same installed APK* directly to each
  # real review route on API34+, then demand fresh role pixels and UI hierarchy.
  # This is stricter, not an invented screenshot or acceptance of a React log.
  if [ "$sdk_level" -ge 34 ]; then
    adb shell am force-stop ru.traksos.app.preview
  fi
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

  # A cold API35 launch (used to avoid stale singleTask guest frames) displays
  # the REAL approved 3.5s native truck splash. DESIGN_REVIEW_RENDERED comes
  # from the React effect BEFORE that splash is removed. Previously the test
  # grabbed a photo of the truck splash, then mislabelled it as a stale guest
  # page and hammered UIAutomator while the emulator was still painting.
  # Read a NEW splash-dismissed event since logcat -c (not a cached marker).
  if [ "$sdk_level" -ge 34 ]; then
    splash_dismissed=0
    for attempt in $(seq 1 45); do
      # Match the native removeView() marker from this same fresh process,
      # not just the duration event: the previous API35 image stayed covered
      # despite reporting that the 3.5-second delay had elapsed.
      if adb logcat -d -s TrakSOSRuntime:I | grep -Fq 'NATIVE_SPLASH_DETACHED'; then
        splash_dismissed=1
        break
      fi
      sleep 1
    done
    if [ "$splash_dismissed" -ne 1 ]; then
      echo "FAIL: fresh native splash never dismissed before Android $sdk_level role=$role"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_DISMISSED=$role API=$sdk_level" >> runtime-ready.log
  fi

  # A React effect and even a logged SPLASH_VISIBLE_MS do not guarantee
  # that Android 15's actual compositor has removed the native truck splash.
  # Never launch expensive UIAutomator while the splash still covers React:
  # in the failing API 35 artifact it wedged the emulator/ADB transport.
  sleep 2
  if [ "$sdk_level" -ge 34 ]; then
    splash_cleared=0
    for attempt in $(seq 1 12); do
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash; then
        splash_cleared=1
        break
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level native splash still visibly covers role=$role after waiting"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Collect true role pixels and fresh accessibility after the overlay is
  # visibly gone, never from a prior role or from the React callback alone.
  painted=0
  for attempt in 1 2 3 4 5; do
    if [ "$sdk_level" -ge 34 ]; then
      # Dump accessibility BEFORE capturing. Waiting for the dump can advance
      # the compositor several frames past the guest or previous role.
      # Every attempt needs a newly generated accessibility tree. Some
      # Android 15 emulators report a successful dump but do not write XML,
      # so stale or error-text files cannot be treated as valid role evidence.
      adb shell rm -f /sdcard/traksos-role.xml || true
      if ! timeout 25s adb shell uiautomator dump /sdcard/traksos-role.xml >/dev/null 2>&1 ||
         ! adb shell test -s /sdcard/traksos-role.xml ||
         ! adb exec-out cat /sdcard/traksos-role.xml > "android-review-$role-ui.xml" ||
         ! grep -Fq '<hierarchy' "android-review-$role-ui.xml"; then
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
