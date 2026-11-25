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
# Fail BEFORE a database dump or container replacement if a stale main checkout
# lacks the exact approved owner PC / Android sources and bundled photographs.
# These are source-presence gates; full screenshot acceptance is still CI-only.
for artwork in \
  web/public/owner20-artwork-sprite.webp \
  web/public/owner20-photo-background-approved.webp \
  web/public/traksos-brand-logo-approved-618.png; do
  [[ -s "$artwork" ]] || fail "Approved 617/618 artwork missing: $artwork. Refusing old design deployment."
done
# Guest PC root is routed through Login, which mounts the approved
# OwnerDesktopHome20261120 React component on desktop.
grep -Fq 'OwnerDesktopHome20261120' web/src/screens/login.tsx ||
  fail "Approved desktop home is not mounted by the guest login route."
grep -Fq '<Login key={route[0]' web/src/main.tsx ||
  fail "Guest entry route is not mounted in this revision."
grep -Fq "approvedPcCabinets20261120.css" web/src/main.tsx ||
  fail "Approved role cabinets are not mounted in this revision."
grep -Fq "androidOwnerVisualAlignment20261120.css" web/src/main.tsx ||
  fail "Approved Android workspaces are not mounted in this revision."
[[ -f scripts/verify-android-618.mjs ]] ||
  fail "Approved Android 618 release guards are absent; refusing deployment."
# Owner-approved 20 Nov 2026 launcher icon is part of the release contract.
# Do not start a production rollout if this checkout lacks the exact approved
# source image or is still carrying the previous Android/RuStore/PWA artwork.
command -v sha256sum >/dev/null || fail "sha256sum unavailable; cannot verify approved icon"
if ! printf '%s\n' \
  '9ea519c3d4cc9b2465459479673cff698e89256e85a11c768d364ddfc2d19cf7  branding/approved-launcher-master-2026-11-20.png' \
  'c43899c1c510ac6dbe33013e30e33630a4f97a791d528c26edf2cd2b523b03ab  branding/tracksos-rustore-icon.png' \
  'c43899c1c510ac6dbe33013e30e33630a4f97a791d528c26edf2cd2b523b03ab  web/public/icon-512.png' \
  'f48bc0073cf5ec1cd8ed784aeb88baad9feeb3a7e6145d5dab6693fc60411e4b  web/public/icon-192.png' \
  | sha256sum --check --status; then
  fail "Approved 20 Nov TrakSOS icon missing or changed. Do not release old icon."
fi
grep -Fq 'icon-192.png?v=approved-20261120' web/index.html ||
  fail "PWA favicon is not versioned for approved 20 Nov icon"
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
# Validate the exact release image in sandbox BEFORE replacing production.
# Optional existing standalone sandbox:
#   TRAKSOS_SANDBOX_DIR=/root/traksos-sandbox/deploy
#   TRAKSOS_SANDBOX_PROJECT=traksos-test bash deploy/update-site.sh
# The external project must ALREADY be running; never create or replace its DB.
if [[ -n "${TRAKSOS_SANDBOX_DIR:-}" ]]; then
  [[ -n "${TRAKSOS_SANDBOX_PROJECT:-}" ]] ||
    fail "TRAKSOS_SANDBOX_PROJECT required for an external sandbox."
  production_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$db")"
  [[ -n "$production_project" && "$TRAKSOS_SANDBOX_PROJECT" != "$production_project" ]] ||
    fail "External sandbox project must not be production."
  sandbox_dir="$(realpath -e "$TRAKSOS_SANDBOX_DIR")" ||
    fail "External sandbox directory not found."
  [[ "$sandbox_dir" != "$(pwd)" ]] ||
    fail "External sandbox must have a separate deployment directory."
  [[ -f "$sandbox_dir/.env" && -f "$sandbox_dir/.env.sandbox" &&
     -f "$sandbox_dir/docker-compose.sandbox.yml" ]] ||
    fail "External sandbox config missing. Production unchanged."
  sandbox_compose=(docker compose --env-file "$sandbox_dir/.env"
    -p "$TRAKSOS_SANDBOX_PROJECT"
    -f "$sandbox_dir/docker-compose.sandbox.yml" --profile sandbox)
else
  [[ -f .env.sandbox && -f docker-compose.sandbox.yml ]] ||
    fail "Sandbox not configured. Production unchanged."
  sandbox_compose=(docker compose -f docker-compose.yml
    -f docker-compose.sandbox.yml --profile sandbox)
fi
"${sandbox_compose[@]}" config --quiet ||
  fail "Sandbox Compose configuration invalid. Production unchanged."
sandbox_id="$("${sandbox_compose[@]}" ps -q sandbox-app)"
sandbox_db_id="$("${sandbox_compose[@]}" ps -q sandbox-db)"
[[ -n "$sandbox_id" && -n "$sandbox_db_id" ]] ||
  fail "Existing sandbox app/db not found. Production unchanged."
for container in "$sandbox_id" "$sandbox_db_id"; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == true ]] ||
    fail "Sandbox container is not running. Production unchanged."
done
[[ "$sandbox_id" != "$(docker compose ps -q app)" &&
   "$sandbox_db_id" != "$db" ]] ||
  fail "Sandbox and production containers overlap. Production unchanged."
prod_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db")"
sandbox_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$sandbox_db_id")"
[[ -n "$prod_volume" && -n "$sandbox_volume" && "$prod_volume" != "$sandbox_volume" ]] ||
  fail "Sandbox and production DB volumes are not isolated. Production unchanged."
echo "Testing release image on isolated sandbox ..."
"${sandbox_compose[@]}" up -d --no-deps sandbox-app ||
  fail "Sandbox update failed. Production unchanged."
sandbox_ready=0
for attempt in $(seq 1 30); do
  if "${sandbox_compose[@]}" exec -T sandbox-app node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{const j=await r.json();process.exit(r.ok&&j.db&&j.sandbox&&j.buildRevision===process.env.TRAKSOS_BUILD_REV?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    sandbox_ready=1
    break
  fi
  sleep 2
done
[[ "$sandbox_ready" == 1 ]] ||
  fail "Sandbox health/revision mismatch. Production unchanged."
echo "Sandbox release checks passed."
echo "Replacing only the app service (no volume deletion, no compose down) ..."
docker compose up -d --no-deps app || fail "App restart failed. Check docker compose logs app"
ready=0
for attempt in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{const j=await r.json();process.exit(r.ok&&j.db&&!j.sandbox&&j.buildRevision===process.env.TRAKSOS_BUILD_REV?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
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
echo "OK: production database, non-sandbox mode and release revision verified."
# Check the same immutable shop constraint after application migrations/startup.
bash ./verify-shop-closed.sh || fail "Shop lock guard failed after deployment; investigate without restoring over live data"
docker compose ps
echo "Release finished. Verify the public site from a browser and run: bash deploy/doctor.sh (from project root)."
echo "SMS provider, admin account and Android push still require separate live checks."
