#!/usr/bin/env bash
# GitHub-hosted, disposable sandbox image smoke test.
# This script MUST NOT be run on a VPS or against real application data.
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] ||
  fail "This preflight is permitted only on GitHub-hosted Actions runners."
rev="${1:-}"
[[ "$rev" =~ ^[0-9a-f]{40}$ ]] || fail "Expected an immutable 40-character Git commit SHA."
command -v docker >/dev/null || fail "Docker unavailable."
docker compose version >/dev/null || fail "Docker Compose unavailable."
command -v openssl >/dev/null || fail "OpenSSL unavailable."
command -v jq >/dev/null || fail "jq unavailable."

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root/deploy"
[[ ! -e .env.sandbox ]] || fail "Refusing to overwrite an existing sandbox environment."
umask 077
export TRAKSOS_RELEASE_REV="$rev"
export SANDBOX_DOMAIN="sandbox.invalid"
export SANDBOX_DB_PASSWORD="$(openssl rand -hex 24)"
shared_secret="$(openssl rand -hex 32)"
app_secret="$(openssl rand -hex 32)"
printf 'APP_SECRET=%s\nSANDBOX_SHARED_SECRET=%s\nSANDBOX_INSTANCE=true\nSMS_PROVIDER=log\nPUSH_PROVIDER=log\nPAYMENT_PROVIDER=mock\n' \
  "$app_secret" "$shared_secret" > .env.sandbox

compose=(docker compose --project-name traksos-ci-preflight -f docker-compose.sandbox.yml --profile sandbox)
cleanup() {
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  rm -f .env.sandbox
}
trap cleanup EXIT

# Sandbox must be on internal networks only; NEVER attach it to production.
"${compose[@]}" config --format json | jq -e '
  (.services["sandbox-app"].networks | if type == "array" then . else keys end | sort) == (["sandbox_private","sandbox_public"] | sort)
  and (.networks | to_entries | all(.value.internal == true))
' >/dev/null || fail "Sandbox Compose network isolation invariant failed."

image="ghcr.io/shipaka/traksos:$rev"
docker pull "$image" >/dev/null || fail "Immutable release image not found in GHCR."
printf 'Verifying isolated candidate image for commit %s\n' "$rev"
"${compose[@]}" up -d --wait --wait-timeout 240 sandbox-db sandbox-app ||
  fail "Disposable sandbox did not become healthy (production not touched)."

# Verify actual API + real isolated Postgres, not just a running process.
"${compose[@]}" exec -T -e EXPECTED_REV="$rev" sandbox-app node -e '
  const fail=()=>process.exit(1);
  fetch("http://127.0.0.1:8080/api/health",{signal:AbortSignal.timeout(8000)})
    .then(async r=>{
      const j=await r.json();
      if(r.ok && j.ok === true && j.db === true &&
         j.sandbox === true && j.buildRevision === process.env.EXPECTED_REV)
        process.exit(0);
      fail();
    }).catch(fail);
' || fail "Sandbox API, DB, isolation or build revision verification failed."

# Exercise actual isolated PostgreSQL (not a painted mock screen).
# Seed the SAME accounts that the protected role handoff will use on the VPS.
"${compose[@]}" exec -T sandbox-app node --import tsx server/src/seedSandbox.ts ||
  fail "Fictitious actor roster could not be seeded in the isolated database."
# Verify that virtual payments are durable and idempotent across provider recreation.
"${compose[@]}" exec -T -e TRAKSOS_RUN_DISPOSABLE_SCENARIO=true sandbox-app \
  node --import tsx server/src/ops/exerciseSandboxPayments.ts ||
  fail "Fictitious checkout/capture/refund/payout lifecycle failed."
"${compose[@]}" exec -T sandbox-app node --import tsx server/src/ops/auditSandbox.ts ||
  fail "Sandbox role, data isolation or ledger conservation audit failed."

printf 'PASS: immutable image, isolated DB, sandbox mode and revision. No VPS actions.\n'
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### TrackSOS — sandbox candidate validated\n- Commit: %s\n- GHCR image: pinned to commit SHA\n- Environment: disposable GitHub-hosted runner only\n- Sandbox API, database and revision: PASS\n- VPS deployment: NOT performed\n' "$rev" >> "$GITHUB_STEP_SUMMARY"
fi
