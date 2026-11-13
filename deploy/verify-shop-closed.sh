#!/usr/bin/env bash
# Read-only guard: the TrackSOS shop MUST stay closed until the owner authorizes opening.
# Does not print secrets, SMS codes, personal data or any other settings.
# Run on the VPS: bash deploy/verify-shop-closed.sh
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

fail() { printf 'BLOCKED: %s\n' "$1" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "Docker is unavailable"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is unavailable"
[[ -f .env ]] || fail "Existing private deploy/.env is missing"
docker compose config --quiet >/dev/null 2>&1 || fail "Docker Compose configuration is invalid"

# A missing settings row means the deployed application still uses its reviewed
# default shop.enabled=false. Any malformed/unexpected value blocks deployment.
sql="select case
  when not exists (select 1 from settings where key='shop') then 'CLOSED_DEFAULT'
  when (select value->>'enabled' from settings where key='shop')='false' then 'CLOSED_CONFIGURED'
  else 'OPEN_OR_INVALID' end;"
if ! state="$(docker compose exec -T db psql -X -A -t -q -U traksos -d traksos \
    -v ON_ERROR_STOP=1 -c "$sql" 2>/dev/null)"; then
  fail "Cannot check shop.enabled from PostgreSQL. Existing data was not changed."
fi
state="$(printf '%s' "$state" | tr -d '\r\n\t ')"
case "$state" in
  CLOSED_DEFAULT|CLOSED_CONFIGURED)
    printf 'OK: Shop is CLOSED in the live database. No settings changed.\n'
    ;;
  OPEN_OR_INVALID)
    fail "Shop is open or has invalid settings; deployment stopped. Investigate privately."
    ;;
  *)
    fail "Unexpected database response; deployment stopped. No settings changed."
    ;;
esac
