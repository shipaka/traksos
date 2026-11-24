#!/usr/bin/env bash
# Runs INSIDE reactivecircus/android-emulator-runner as a single shell command.
# The action invokes each script line individually; loops must live in this file.
# All output is non-sensitive: readiness tags, screenshot, foreground state, crash log.
set -Eeuo pipefail

# Android 15 emulators can lose the adb transport *after* an app has already
# launched. A bare adb exec-out/cat then blocks until GitHub cancels the whole
# 35-minute job. Bound every direct adb subprocess and FAIL CLOSED instead:
# no PASS without fresh screenshots, UI hierarchy and a responsive device.
ADB_BIN="${ADB_BIN:-$(command -v adb || true)}"
ADB_PHASE=startup
adb_bounded() {
  local budget="$1" rc=0 args
  shift
  printf -v args '%q ' "$@"
  printf 'ADB_BEGIN phase=%s budget=%s command=%s\n' "$ADB_PHASE" "$budget" "$args" >&2
  printf 'ADB_BEGIN phase=%s budget=%s command=%s\n' "$ADB_PHASE" "$budget" "$args" >> android-compositor-diagnostics.log
  timeout --signal=TERM --kill-after=2s "$budget" "$ADB_BIN" "$@" || rc=$?
  printf 'ADB_END phase=%s rc=%s command=%s\n' "$ADB_PHASE" "$rc" "$args" >&2
  printf 'ADB_END phase=%s rc=%s command=%s\n' "$ADB_PHASE" "$rc" "$args" >> android-compositor-diagnostics.log
  return "$rc"
}
adb() { adb_bounded 35s "$@"; }
# If the API35 emulator process disappears, adb can spend 35 seconds on
# *each* command saying "waiting for device". Stop the current role promptly,
# preserve the screenshot and runtime logs, and keep this gate RED.
require_live_emulator() {
  local state
  if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
    return 0
  fi
  echo "FAIL: Android emulator ADB transport disconnected during $1"
  adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
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

# Full window dump: restricted window subsection omitted focus on both API levels.
read_focus_dump() {
  local phase="$1" dump
  dump="$(adb_bounded 12s shell dumpsys window | tr -d '\r')" || return 1
  printf '\n--- full window dump: %s ---\n%s\n' "$phase" "$dump" >> android-compositor-diagnostics.log
  if ! grep -Eq '^[[:space:]]*mCurrentFocus=' <<< "$dump"; then
    dump="$(adb_bounded 12s shell dumpsys activity activities | tr -d '\r')" || return 1
    printf '\n--- activity focus fallback: %s ---\n%s\n' "$phase" "$dump" >> android-compositor-diagnostics.log
  fi
  grep -Eq '^[[:space:]]*mCurrentFocus=' <<< "$dump" || return 1
  printf '%s\n' "$dump"
}

# Recover only the SYSTEM Pixel Launcher ANR on the headless Android 15
# 320x640 CI emulator. Real PNG + activity dump (run #45258778347) prove:
# mCurrentFocus = ANR for com.google.android.apps.nexuslauncher,
# mFocusedApp = ru.traksos.app.preview/MainActivity.
# Do not dismiss another app's dialog or weaken the DOM/pixel verification.
recover_launcher_anr() {
  local context="$1" windows dimensions focus_line app_line
  windows="$(read_focus_dump "$context-launcher-recovery")" || return 1
  # Here-strings avoid SIGPIPE false negatives under set -o pipefail: the
  # full dumpsys window dump may exceed a pipe buffer on Android 15.
  focus_line="$(grep -m1 -F 'mCurrentFocus=' <<< "$windows" || true)"
  if [[ "$focus_line" != *'Application Not Responding: com.google.android.apps.nexuslauncher'* ]]; then
    return 0
  fi
  app_line="$(grep -m1 -F 'mFocusedApp=' <<< "$windows" || true)"
  if [[ "$app_line" != *'ru.traksos.app.preview'* ]]; then
    echo "FAIL: launcher ANR is not over the TrakSOS Activity ($context)"
    return 1
  fi
  dimensions="$(adb shell wm size | tr -d '\r')"
  if ! echo "$dimensions" | grep -Eq '(^| )320x640$'; then
    echo "FAIL: system ANR on unexpected display $dimensions"
    return 1
  fi
  echo "INFO: confirmed Pixel Launcher SYSTEM ANR; choosing Wait ($context)"
  echo "$windows" | grep -E 'mCurrentFocus=|mFocusedApp=' >> android-compositor-diagnostics.log || true
  # The captured fixed-size dialog has Close app at y=330 and Wait at y=378.
  adb shell input tap 117 378
  sleep 2
  windows="$(read_focus_dump "$context-launcher-recovery")" || return 1
  focus_line="$(grep -m1 -F 'mCurrentFocus=' <<< "$windows" || true)"
  if [[ "$focus_line" == *'Application Not Responding: com.google.android.apps.nexuslauncher'* ]]; then
    echo "FAIL: Pixel Launcher ANR remains visible after Wait"
    return 1
  fi
  echo "SYSTEM_LAUNCHER_ANR_WAIT=$context" >> runtime-ready.log
}

# DOM and nonuniform pixels do not prove that the actual app is foregrounded.
# Require the exact native Activity window, not merely a running PID or an
# underlying focused app while an Android dialog/another window owns input.
# Reject ambiguous focus evidence (e.g. multiple displays).
has_traksos_focus() {
  local dump focus
  dump=$(cat)
  focus=$(grep -E '^[[:space:]]*mCurrentFocus=' <<< "$dump") || return 1
  [[ "$focus" != *has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$good"
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
\n'* ]] || return 1
  grep -Eq '^[[:space:]]*mCurrentFocus=Window\{[^}]*[[:space:]]ru\.traksos\.app\.preview/(ru\.traksos\.app\.MainActivity|\.MainActivity)[[:space:]]*\}[[:space:]]*has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
 <<< "$focus"
}
has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
\n'"$overlay" ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
\n'* ]] || return 1
  grep -Eq '^[[:space:]]*mCurrentFocus=Window\{[^}]*[[:space:]]ru\.traksos\.app\.preview/(ru\.traksos\.app\.MainActivity|\.MainActivity)[[:space:]]*\}[[:space:]]*has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$good"
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
 <<< "$focus"
}
has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
\n'"$overlay" ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
 <<< "$focus"
}
has_traksos_runtime_error() {
  grep -Eq 'Process: ru\.traksos\.app\.preview([:,[:space:]]|$)|am_(anr|crash).*[,[:space:]]ru\.traksos\.app\.preview(:[^,[:space:]]+)?[,[:space:]]'
}
verify_gate_controls() {
  local good='  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  local overlay='  mCurrentFocus=Window{abc u0 Application Not Responding: ru.traksos.app.preview}'
  local underlying='  mFocusedApp=ActivityRecord{abc u0 ru.traksos.app.preview/ru.traksos.app.MainActivity}'
  if ! has_traksos_focus <<< "$good" ||
     ! has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview/.MainActivity}' ||
     has_traksos_focus <<< "$overlay"$'\n'"$underlying" ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 com.android.systemui/.SomeDialog}' ||
     has_traksos_focus <<< '  mCurrentFocus=Window{abc u0 ru.traksos.app.preview.other/.MainActivity}' ||
     has_traksos_focus <<< '  mCurrentFocus=null' ||
     has_traksos_focus <<< "$good"
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
\n'"$overlay" ||
     has_traksos_focus <<< "$underlying"; then
    echo 'FAIL: foreground gate negative/positive controls'
    return 1
  fi
  if ! has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview, PID: 42' ||
     ! has_traksos_runtime_error <<< 'I am_anr: [0,42,ru.traksos.app.preview,0,reason]' ||
     ! has_traksos_runtime_error <<< 'I am_crash: [0,42,ru.traksos.app.preview:worker,0,reason]' ||
     has_traksos_runtime_error <<< 'I am_anr: [0,42,com.google.android.apps.nexuslauncher,0,reason]' ||
     has_traksos_runtime_error <<< 'E AndroidRuntime: Process: ru.traksos.app.preview.other, PID: 42'; then
    echo 'FAIL: native crash gate negative/positive controls'
    return 1
  fi
  echo 'PASS: native foreground and crash parser controls'
}
require_traksos_foreground() {
  local phase="$1" windows
  require_live_emulator "$phase foreground"
  windows="$(read_focus_dump "$phase")" || {
    echo "FAIL: no reliable current-focus evidence ($phase)"
    adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    return 1
  }
  {
    printf '\n--- foreground checkpoint: %s ---\n' "$phase"
    grep -E 'mCurrentFocus=|mFocusedApp=' <<< "$windows" || true
  } >> android-compositor-diagnostics.log
  if ! has_traksos_focus <<< "$windows"; then
    echo "FAIL: TrakSOS Activity does not own the focused window ($phase)"
    return 1
  fi
  echo "APK_FOREGROUND_CONFIRMED=$phase" >> runtime-ready.log
}
verify_gate_controls
if [[ "${1:-}" == --self-test-focus ]]; then exit 0; fi
test -x "$ADB_BIN"
rm -f emulator-ui.xml
apk="apk/app-debug.apk"
test -s "$apk"
adb install -r "$apk"
# Clear all relevant buffers ONCE, before the first launch. Never erase
# crash/ANR evidence between roles.
adb logcat -b main -b system -b crash -b events -c
: > runtime-errors.log
capture_runtime_errors() {
  local phase="$1" snapshot
  printf '\n--- runtime checkpoint: %s ---\n' "$phase" >> runtime-errors.log
  snapshot="$(adb logcat -b main -b crash -d -s AndroidRuntime:E)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  snapshot="$(adb logcat -b events -d -s am_anr:I am_crash:I)" || return 1
  printf '%s\n' "$snapshot" >> runtime-errors.log
  # AndroidRuntime identifies Java/native-process crashes; ActivityManager
  # event records also catch ANRs and crashes followed by an automatic restart.
  # Do not mistake the unrelated Pixel Launcher event for a TrakSOS event.
  if has_traksos_runtime_error < runtime-errors.log; then
    echo "FAIL: native TrakSOS crash or ANR observed ($phase)"
    return 1
  fi
}
preserve_failure_logs() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    ADB_PHASE=failure-exit
    local state
    adb_bounded 7s devices -l >> android-compositor-diagnostics.log 2>&1 || true
    ps -eo pid,comm | grep -E 'adb|emulator|qemu' >> android-compositor-diagnostics.log || true
    if state="$(adb_bounded 7s get-state)" && [[ "$state" == device ]]; then
      capture_runtime_errors "failure-exit" || true
      adb_bounded 12s shell dumpsys input >> android-compositor-diagnostics.log 2>&1 || true
    fi
  fi
  return "$rc"
}
trap preserve_failure_logs EXIT
ADB_PHASE=guest
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
capture_runtime_errors guest-render
adb shell dumpsys activity activities > activity-dump.txt || true
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# A DOM-ready WebView can still be black at the compositor. Wait briefly
# for the actual screenshot to contain nonuniform guest artwork and controls.
screen_ok=0
for frame in 1 2 3 4; do
  require_live_emulator "guest pixel capture $frame"
  adb exec-out screencap -p > emulator-screen.png || true
  if python3 scripts/verify-android-screen.py emulator-screen.png; then
    screen_ok=1
    break
  fi
  sleep 3
done
# Never count a system overlay as a painted guest app.
if [ "$sdk_level" -ge 34 ]; then
  recover_launcher_anr "guest" || exit 1
  adb exec-out screencap -p > emulator-screen.png
  python3 scripts/verify-android-screen.py emulator-screen.png || exit 1
fi
# Do not invoke UIAutomator on headless Android 15. Real APK #45206987070
# rendered both React and the home screenshot correctly, but UIAutomator
# killed its emulator/ADB transport before any role test could execute.
# On API 34+, the strict DOM gate below uses the installed debug WebView.
if [ "$sdk_level" -lt 34 ] && adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
  adb exec-out cat /sdcard/traksos-window.xml > emulator-ui.xml || true
fi
# Avoid counting the emulator's unrelated launcher ANR as a blank or bad
# TrakSOS screen. Recovery is narrow; the fresh capture remains mandatory.
if [ "$sdk_level" -lt 34 ] && [ -s emulator-ui.xml ] && grep -Fq "Pixel Launcher isn't responding" emulator-ui.xml; then
  dismiss_pixel_launcher_anr emulator-ui.xml || exit 1
  if adb_bounded 30s shell uiautomator dump /sdcard/traksos-window.xml >/dev/null 2>&1; then
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
require_traksos_foreground "guest-before-pixels"
adb exec-out screencap -p > emulator-screen.png
require_traksos_foreground "guest-after-pixels"
python3 scripts/verify-android-screen.py emulator-screen.png
adb shell pidof ru.traksos.app.preview
capture_runtime_errors guest-final
grep -F 'ru.traksos.app.preview' activity-dump.txt
if [ -s emulator-ui.xml ] && grep -Eiq "System UI isn.t responding|App isn.t responding" emulator-ui.xml; then
  echo 'FAIL: Android ANR dialog covers the application'
  exit 1
fi
# Review the ACTUAL React workspaces, not the removed fake offline dashboard.
# This evidence comes from an installed APK in the emulator, not browser mockups.
sdk_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
for role in client master; do
  ADB_PHASE="$role"
  # Readiness logs fire on React effect and can precede WebView compositor.
  # Role markers must be absent before navigation; retain all crash evidence.
  # API35 Google-API headless AVD on GitHub repeatedly loses the *entire*
  # emulator/ADB connection after force-stop of an already-rendered APK.
  # MainActivity is singleTask; onNewIntent() explicitly reloads the REAL
  # APK-packaged web view for android-review/<role>. Use that route instead.
  # A stale compositor frame still fails the real-pixel comparison below,
  # and the live WebView DOM must independently show the correct role.
  require_live_emulator "before $role navigation"
  capture_runtime_errors "before-$role"
  existing_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
  if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$existing_markers"; then
    echo "FAIL: stale role readiness marker before $role navigation"
    exit 1
  fi
  adb shell am start -W -n ru.traksos.app.preview/ru.traksos.app.MainActivity --es path "android-review/$role" >/dev/null
  found=0
  for attempt in $(seq 1 35); do
    role_markers="$(adb logcat -d -s TrakSOSRuntime:I)"
    if grep -Fq "DESIGN_REVIEW_RENDERED=$role" <<< "$role_markers"; then
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
    # A React event proves mounting, NOT that the native compositor switched
    # away from the guest page. Run distinct-pixel proof before attaching
    # DevTools; the old order could wedge API35 while its screenshot was still
    # pixel-for-pixel the guest (run #45261164963, client 320x640).
    prior_screens=(emulator-screen.png)
    if [ "$role" = master ]; then prior_screens+=(android-review-client.png); fi
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role pixel capture attempt $attempt"
      adb exec-out screencap -p > "android-review-$role.png" || true
      if python3 scripts/verify-android-screen.py "android-review-$role.png" --reject-native-splash "${prior_screens[@]}"; then
        splash_cleared=1
        break
      fi
      # Capture a bounded, narrow diagnostic at the FIRST visually stale
      # frame, while ADB still works. It helps distinguish an app crash from
      # the Android 15 software compositor/emulator transport disappearing.
      # Diagnostics never turn a failed image into a PASS.
      if [ "$attempt" -eq 1 ]; then
        adb_bounded 12s logcat -d -v brief -s TrakSOSRuntime:I AndroidRuntime:E SurfaceFlinger:W WindowManager:W           >> android-compositor-diagnostics.log 2>&1 || true
      fi
      sleep 2
    done
    if [ "$splash_cleared" -ne 1 ]; then
      adb logcat -d -s TrakSOSRuntime:I >> runtime-ready.log || true
      echo "FAIL: Android $sdk_level role=$role has no distinct painted UI after navigation; may be splash, stale guest frame or compositor"
      exit 1
    fi
    echo "APK_REVIEW_SPLASH_PIXELS_CLEARED=$role API=$sdk_level" >> runtime-ready.log
  else
    adb exec-out screencap -p > "android-review-$role.png" || true
  fi
  # Android 15's headless Pixel image can wedge/detach ADB when UIAutomator
  # runs, even though the native Activity and React UI are healthy. Inspect the
  # REAL packaged WebView DOM through its localhost-only debug DevTools socket.
  # The same independent role identity check is required on API29 too.
  # In production BuildConfig.DEBUG is false and the socket is not exposed.
  if [ "$sdk_level" -ge 29 ]; then
    web_pid=$(adb shell pidof ru.traksos.app.preview | tr -d '\r' | awk '{print $1}')
    if [ -z "$web_pid" ]; then
      echo "FAIL: no running native TrakSOS app process for role=$role"
      exit 1
    fi
    adb forward --remove tcp:9222 >/dev/null 2>&1 || true
    adb forward tcp:9222 "localabstract:webview_devtools_remote_$web_pid"
    dom_confirmed=0
    for attempt in $(seq 1 12); do
      require_live_emulator "during $role live DOM attempt $attempt"
      if timeout --signal=TERM --kill-after=2s 15s python3 scripts/verify-android-webview.py "$role"; then
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
    require_traksos_foreground "$role-before-pixels"
    adb exec-out screencap -p > "android-review-$role.png"
    require_traksos_foreground "$role-after-pixels"
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
  capture_runtime_errors "after-$role"
  echo "APK_ROLE_UI_CONFIRMED=$role API=$sdk_level" >> runtime-ready.log
done
require_traksos_foreground "final"
capture_runtime_errors final
echo "PASS: TrakSOS guest and painted React Android role screens verified on API=$sdk_level; splash ${visible_ms}ms; no TrakSOS crash or ANR in captured runtime logs"
