#!/usr/bin/env bash
# TrackSOS: read-only readiness assessment of the ACTUAL sandbox VPS.
# Not an installer, not an updater, and must not expose .env, DB rows or logs.
# This script is staged in GitHub; it is NOT installed/executed on VPS by this PR.
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

fail() { printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
warn() { printf 'ATTENTION: %s\n' "$*" >&2; failed=1; }
failed=0
CHECKOUT=/root/traksos-sandbox
PROD_DB=deploy-db-1
PROD_APP=deploy-app-1
SANDBOX_DB=traksos-test-sandbox-db-1
SANDBOX_APP=traksos-test-sandbox-app-1

command -v docker >/dev/null || fail 'Docker not available'
command -v git >/dev/null || fail 'Git not available'
command -v curl >/dev/null || fail 'curl not available'
command -v python3 >/dev/null || fail 'Python 3 not available'

# Read only the git revision; never pull, checkout, reset or touch local edits.
[[ -d "$CHECKOUT/.git" ]] || warn 'Independent sandbox checkout is missing'
if [[ -d "$CHECKOUT/.git" ]]; then
  revision="$(git -C "$CHECKOUT" rev-parse HEAD 2>/dev/null)" ||
    warn 'Cannot read independent sandbox checkout revision'
  if [[ -n "${revision:-}" ]]; then printf 'SANDBOX_CHECKOUT_REVISION=%s\n' "$revision"; fi
fi
[[ -f "$CHECKOUT/deploy/docker-compose.sandbox.yml" ]] ||
  warn 'Sandbox-only Compose file not present at known path'
[[ -f "$CHECKOUT/deploy/.env.sandbox" ]] ||
  warn 'Sandbox environment file not present (contents intentionally hidden)'

for name in "$PROD_DB" "$PROD_APP" "$SANDBOX_DB" "$SANDBOX_APP"; do
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    warn "Expected container missing: $name"
    continue
  fi
  status="$(docker inspect --format '{{.State.Status}}' "$name")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$name")"
  image="$(docker inspect --format '{{.Config.Image}}' "$name")"
  printf 'CONTAINER=%s status=%s health=%s image=%s\n' "$name" "$status" "$health" "$image"
  [[ "$status" == running ]] || warn "$name is not running"
  [[ "$health" != unhealthy ]] || warn "$name is unhealthy"
done

if docker container inspect "$PROD_DB" "$SANDBOX_APP" >/dev/null 2>&1; then
  prod_networks="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .NetworkID}}{{end}}' "$PROD_DB" | sort -u)"
  sandbox_networks="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .NetworkID}}{{end}}' "$SANDBOX_APP" | sort -u)"
  [[ -n "$prod_networks" && -n "$sandbox_networks" ]] ||
    warn 'Unable to verify isolated Docker networks'
  overlap="$(comm -12 <(printf '%s\n' "$prod_networks") <(printf '%s\n' "$sandbox_networks"))"
  [[ -z "$overlap" ]] || warn 'Sandbox app shares a Docker network with production DB'
else
  warn 'Cannot verify sandbox/production network separation'
fi

if docker container inspect "$PROD_DB" "$SANDBOX_DB" >/dev/null 2>&1; then
  prod_volumes="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$PROD_DB" | sort -u)"
  sandbox_volumes="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$SANDBOX_DB" | sort -u)"
  [[ -n "$prod_volumes" && -n "$sandbox_volumes" ]] ||
    warn 'Unable to verify separate database volumes'
  overlap="$(comm -12 <(printf '%s\n' "$prod_volumes") <(printf '%s\n' "$sandbox_volumes"))"
  [[ -z "$overlap" ]] || warn 'Sandbox DB and production DB share a Docker volume'
else
  warn 'Cannot verify distinct database volumes'
fi

# The isolated sandbox must actually contain ALL 12 test accounts. Merely
# having a healthy container is insufficient: a missing courier fixture makes
# the signed handoff fail with sandbox_access_denied. Read only; display role
# NAMES, never phone numbers, tokens, environment values or database rows.
if docker container inspect "$SANDBOX_DB" >/dev/null 2>&1; then
  if missing_roles="$(docker exec "$SANDBOX_DB" psql -U sandbox_user -d traksos_sandbox \
      -X -A -t -q -v ON_ERROR_STOP=1 -c "
    with required(label,phone,primary_role,secondary_role) as (values
      ('client','+79000000002','client',null),
      ('owner','+79000000003','client',null),
      ('driver','+79000000004','driver','client'),
      ('master','+79000000011','master',null),
      ('tow','+79000000021','tow',null),
      ('service','+79000000031','service',null),
      ('master_service','+79000000051','master','service'),
      ('insurer','+79000000052','insurer',null),
      ('inspection','+79000000053','inspection_operator',null),
      ('courier','+79000000054','courier',null),
      ('moderator','+79000000005','moderator',null),
      ('admin','+79000000001','admin',null)
    )
    select r.label from required r left join users u on u.phone=r.phone
      where u.id is null or u.status <> 'active'
        or not(r.primary_role=any(u.roles))
        or (r.secondary_role is not null and not(r.secondary_role=any(u.roles)))
      order by r.label;
  " 2>/dev/null)"; then
    if [[ -z "$missing_roles" ]]; then
      echo 'SANDBOX_ROLE_FIXTURES=12/12 verified (read-only)'
    else
      warn "Sandbox role fixtures absent/inactive/incorrect: $(printf '%s' "$missing_roles" | paste -sd, -)"
    fi
  else
    warn 'Cannot check sandbox role fixtures read-only; verify schema/database and sandbox DB container'
  fi
else
  warn 'Cannot check sandbox role fixtures because the sandbox DB container is missing'
fi

# Public health endpoints do not expose any secrets; emit only allowlisted flags.
for target in production sandbox; do
  if [[ "$target" == production ]]; then domain=traksos.ru; else domain=sandbox.traksos.ru; fi
  if ! curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 15 \
      "https://$domain/api/health" | python3 -c '
import json,sys
want=sys.argv[1] == "sandbox"
try:
    d=json.load(sys.stdin)
    assert d["ok"] is True and d["db"] is True and d["sandbox"] is want
    rev=d.get("buildRevision")
    assert isinstance(rev,str) and len(rev)>=7 and rev!="unknown"
    print("HEALTH=%s ok=true db=true sandbox=%s revision=%s" %
          (sys.argv[1],str(want).lower(),rev))
except (AssertionError,KeyError,ValueError,TypeError):
    sys.exit(1)
' "$target"; then
    warn "$domain failed HTTPS/database/environment/revision check"
  fi
done

if (( failed )); then
  echo 'RESULT: BLOCKED. No deployment attempted or files changed.'
  exit 1
fi
echo 'RESULT: READINESS CHECK PASSED. No deployment attempted or files changed.'
