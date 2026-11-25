#!/usr/bin/env bash
# CI-only: require a live local server and successful database health response.
set -euo pipefail
pid=${1:?server PID required}
log=${2:?server log required}
budget=${3:-90}
port=${4:-8080}
[[ $pid =~ ^[1-9][0-9]*$ && $budget =~ ^[1-9][0-9]*$ && $port =~ ^[1-9][0-9]*$ ]] || exit 2
(( budget <= 120 && port <= 65535 )) || exit 2
url="http://127.0.0.1:${port}/api/health"
deadline=$((SECONDS + budget))
reason='HTTP or database health not ready'
while (( SECONDS < deadline )); do
  if ! kill -0 "$pid" 2>/dev/null; then
    reason='test server process exited'
    break
  fi
  remaining=$((deadline - SECONDS))
  (( remaining > 2 )) && remaining=2
  if response=$(curl --noproxy '*' --silent --fail --connect-timeout 1 \
      --max-time "$remaining" --max-filesize 65536 --write-out '\n%{http_code}' "$url"); then
    status=${response##*$'\n'}
    body=${response%$'\n'*}
    if [[ $status == 200 ]] && jq -es 'length == 1 and .[0].ok == true and .[0].db == true' \
        <<< "$body" >/dev/null 2>&1 && kill -0 "$pid" 2>/dev/null; then
      echo 'PASS: test server HTTP 200 and database ready'
      exit 0
    fi
  fi
  (( SECONDS < deadline )) && sleep 1
done
printf 'FAIL: %s (budget %ss)\n' "$reason" "$budget" >&2
if [[ -f $log ]]; then tail -n 80 -- "$log" >&2; fi
exit 1
