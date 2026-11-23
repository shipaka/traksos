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
# If the API35 emulator process disappears, adb can spend 35 seconds on
# *each* command saying "waiting for device". Stop the current role promptly,
# preserve the screenshot and runtime logs, and keep this gate RED.
require_live_emulator() {
  if timeout --signal=TERM --kill-after=2s 7s "$ADB_BIN" get-state 2>/dev/null |
      grep -Fxq device; then
    return 0
  fi
  echo "FAIL: Android emulator ADB transport disconnected during $1"
  timeout 7s "$ADB_BIN" devices -l >> android-compositor-diagnostics.log 2>&1 || true
  exit 1
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

# Dismiss only a *verified system* Pixel Launcher ANR in the fixed
# Android 15 CI 320x640 emulator. Confirmed in API35 run #45258778347:
# mCurrentFocus = Application Not Responding: com.google.android.apps.nexuslauncher
# mFocusedApp = ru.traksos.app.preview/MainActivity.
# UIAutomator itself hangs this emulator. This does NOT dismiss TrakSOS ANRs,
# skip WebView DOM validation, or waive distinct painted screenshot checks.
recover_launcher_anr() {
  local context="$1" windows dimensions
  windows="$(adb shell dumpsys window windows 2>/dev/null || true)"
  if ! echo "$windows" | grep -F 'mCurrentFocus=' | grep -Fq 'Application Not Responding: com.google.android.apps.nexuslauncher'; then return 0; fi
  if ! echo "$windows" | grep -F 'mFocusedApp=' | grep -Fq 'ru.traksos.app.preview'; then
    echo "FAIL: unexpected active app underneath launcher system ANR ($context)"
    return 1
  fi
  dimensions="$(adb shell wm size | tr -d '\r')"
  if ! echo "$dimensions" | grep -Eq '(^| )320x640
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
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
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
# Dismiss the EXACT unrelated launcher dialog before saving guest evidence.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && timeout 30s adb shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
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

  # The first genuine Activity startup above already passed the real 3.5s
  # native-splash AND painted-guest checks. SingleTask review navigation does
  # not create a new native splash, so demanding a second DETACHED event
  # would be false evidence. If Android recreates Activity, the native
  # splash will be rejected by --reject-native-splash below until it clears.
  # Never treat a React-only event as visual proof.
  require_live_emulator "after $role React render"
  if [ "$sdk_level" -ge 34 ]; then
    recover_launcher_anr "$role" || exit 1
  fi
  sleep 2
  if [ "$sdk_level" -ge 34 ]; then
    splash_cleared=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        timeout 12s "$ADB_BIN" logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           > android-compositor-diagnostics.log 2>&1 || true
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
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 34 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      if timeout 15s python3 scripts/verify-android-webview.py "$role"; then
        dom_confirmed=1
        break
      fi
      sleep 2
    done
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    if [ "$dom_confirmed" -ne 1 ]; then
      echo "FAIL: Android $sdk_level role=$role lacks independent live WebView DOM evidence"
      exit 1
    fi
    echo "APK_REVIEW_LIVE_WEBVIEW_DOM=$role API=$sdk_level" >> runtime-ready.log
  fi
  # A DevTools DOM result alone is insufficient. We additionally require
  # screenshot evidence from the actual emulator, not a browser mock,
  # distinct from the guest AND the previously verified role.
  painted=0
  for attempt in 1 2 3 4 5; do
    require_live_emulator "before $role role-specific screenshot attempt $attempt"
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
; then
    echo "FAIL: cannot safely select Wait on unexpected screen $dimensions"
    return 1
  fi
  echo "INFO: confirmed launcher-only system ANR, choosing Wait ($context)"
  echo "$windows" | grep -E 'mCurrentFocus=|mFocusedApp=' >> android-compositor-diagnostics.log || true
  # Exact CI dialog: Close app is at y=331, Wait is at y=378.
  adb shell input tap 117 378
  sleep 2
  windows="$(adb shell dumpsys window windows 2>/dev/null || true)"
  if echo "$windows" | grep -F 'mCurrentFocus=' | grep -Fq 'Application Not Responding: com.google.android.apps.nexuslauncher'; then
    echo "FAIL: Pixel Launcher system ANR remains visible"
    return 1
  fi
  echo "SYSTEM_LAUNCHER_ANR_WAIT=$context" >> runtime-ready.log
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
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
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
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && timeout 30s adb shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
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

  # The first genuine Activity startup above already passed the real 3.5s
  # native-splash AND painted-guest checks. SingleTask review navigation does
  # not create a new native splash, so demanding a second DETACHED event
  # would be false evidence. If Android recreates Activity, the native
  # splash will be rejected by --reject-native-splash below until it clears.
  # Never treat a React-only event as visual proof.
  require_live_emulator "after $role React render"
  sleep 2
  if [ "$sdk_level" -ge 34 ]; then
    splash_cleared=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        timeout 12s "$ADB_BIN" logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           > android-compositor-diagnostics.log 2>&1 || true
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
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 34 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      if timeout 15s python3 scripts/verify-android-webview.py "$role"; then
        dom_confirmed=1
        break
      fi
      sleep 2
    done
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    if [ "$dom_confirmed" -ne 1 ]; then
      echo "FAIL: Android $sdk_level role=$role lacks independent live WebView DOM evidence"
      exit 1
    fi
    echo "APK_REVIEW_LIVE_WEBVIEW_DOM=$role API=$sdk_level" >> runtime-ready.log
  fi
  # A DevTools DOM result alone is insufficient. We additionally require
  # screenshot evidence from the actual emulator, not a browser mock,
  # distinct from the guest AND the previously verified role.
  painted=0
  for attempt in 1 2 3 4 5; do
    require_live_emulator "before $role role-specific screenshot attempt $attempt"
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
