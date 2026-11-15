#!/usr/bin/env bash
# TrackSOS release: backup first, then replace the app container (never delete volumes).
# Run after fetching approved main: bash deploy/update-site.sh
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }
command -v docker >/dev/null || fail "Docker unavailable"
docker compose version >/dev/null 2>&1 || fail "Docker Compose unavailable"
[[ "$(git branch --show-current)" == main ]] || fail "Expected the main branch"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "Tracked local changes detected. Resolve them before release."
[[ -f deploy/.env ]] || fail "deploy/.env missing (server secrets were NOT created or modified)"
[[ -f deploy/docker-compose.yml ]] || fail "Compose file missing"
# Baked into the same release image for both prod and isolated test instances.
export TRAKSOS_RELEASE_REV="$(git rev-parse HEAD)"
cd deploy
docker compose config --quiet || fail "Invalid Compose configuration"
# Release lock: refuse to update while the approved shop is unexpectedly open.
bash ./verify-shop-closed.sh || fail "Shop lock guard failed before deployment"
db="$(docker compose ps -q db)"
[[ -n "$db" && "$(docker inspect -f '{{.State.Running}}' "$db" 2>/dev/null)" == true ]] ||
  fail "Database container is not running. Do not deploy."
mkdir -p backups
umask 077
backup="backups/pre-release-$(date -u +%Y%m%d-%H%M%S).dump"
# A pg_dump --custom archive is required before a release that has schema migrations.
echo "Creating PostgreSQL backup (contents are never shown) ..."
if ! docker compose exec -T db pg_dump -U traksos -Fc traksos > "$backup"; then
  rm -f "$backup"
  fail "pg_dump failed; application has not been touched"
fi
[[ -s "$backup" ]] || { rm -f "$backup"; fail "Backup is empty"; }
docker compose exec -T db pg_restore --list < "$backup" >/dev/null ||
  fail "Backup archive is invalid. App has not been touched."
echo "Verified archive: $backup"
echo "Checked out revision: $(git -C "$ROOT" rev-parse --short HEAD)"

# Building before recreating the app ensures a compile error cannot stop the old site.
echo "Building new app image ..."
docker compose build app || fail "Build failed. Existing app still running."
echo "Replacing only the app service (no volume deletion, no compose down) ..."
docker compose up -d --no-deps app || fail "App restart failed. Check docker compose logs app"
ready=0
for attempt in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  echo "The new app did not pass its health check. DO NOT attempt automatic schema rollback." >&2
  echo "Database archive: $backup" >&2
  docker compose ps
  exit 1
fi
echo "OK: application API answers /api/health inside the container."
# Check the same immutable shop constraint after application migrations/startup.
bash ./verify-shop-closed.sh || fail "Shop lock guard failed after deployment; investigate without restoring over live data"
docker compose ps
echo "Release finished. Verify the public site from a browser and run: bash deploy/doctor.sh (from project root)."
# Optional sandbox uses the SAME locally built image as production. Never
# build a second frontend for tests. If sandbox is not provisioned, leave it off.
if [[ -f .env.sandbox && -f docker-compose.sandbox.yml && -n "${SANDBOX_URL:-}" ]]; then
  sandbox_id="$(docker compose -f docker-compose.yml -f docker-compose.sandbox.yml --profile sandbox ps -q sandbox-app)"
  if [[ -n "$sandbox_id" && "$(docker inspect -f '{{.State.Running}}' "$sandbox_id" 2>/dev/null)" == true ]]; then
    echo "Updating isolated test app from the very same image ..."
    docker compose -f docker-compose.yml -f docker-compose.sandbox.yml --profile sandbox up -d --no-deps sandbox-app ||
      fail "Production updated; sandbox restart failed. Fix sandbox before role testing."
    matched=0
    for attempt in $(seq 1 30); do
      if docker compose -f docker-compose.yml -f docker-compose.sandbox.yml --profile sandbox exec -T sandbox-app \
         node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{const j=await r.json();process.exit(r.ok&&j.db&&j.sandbox&&j.buildRevision===process.env.TRAKSOS_BUILD_REV?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        matched=1
        break
      fi
      sleep 2
    done
    [[ "$matched" == 1 ]] ||
      fail "Production updated; sandbox health/version mismatch. Test role access disabled until fixed."
    echo "Sandbox and production now run the same release commit: $TRAKSOS_RELEASE_REV"
  else
    echo "Sandbox is configured but not yet running; no simulated user data was touched."
  fi
fi
echo "SMS provider, admin account and Android push still require separate live checks."
