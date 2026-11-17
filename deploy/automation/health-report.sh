#!/usr/bin/env bash
# TrackSOS restricted, root-owned server health report.
# No parameters. No writes. No secrets or unfiltered logs printed.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

printf 'TrackSOS server health (read-only)\n'
failed=0
for name in traksos-test-sandbox-app-1 traksos-test-sandbox-db-1 deploy-app-1 deploy-db-1; do
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    printf 'MISSING: %s\n' "$name"
    failed=1
    continue
  fi
  status="$(docker inspect -f '{{.State.Status}}' "$name")"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$name")"
  image="$(docker inspect -f '{{.Config.Image}}' "$name")"
  printf 'CONTAINER: %s status=%s health=%s image=%s\n' "$name" "$status" "$health" "$image"
  if [[ "$status" != running || "$health" == unhealthy ]]; then failed=1; fi
done

if docker container inspect traksos-test-sandbox-app-1 >/dev/null 2>&1 &&
   docker container inspect deploy-db-1 >/dev/null 2>&1; then
  sandbox_nets="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' traksos-test-sandbox-app-1)"
  prod_db_nets="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' deploy-db-1)"
  shared=0
  while IFS= read -r network; do
    [[ -z "$network" ]] && continue
    if grep -Fxq -- "$network" <<< "$prod_db_nets"; then shared=1; fi
  done <<< "$sandbox_nets"
  if (( shared )); then
    echo "BLOCKED: sandbox application and production database share a Docker network."
    failed=1
  else
    echo "OK: sandbox application does not share Docker networks with production database."
  fi
else
  echo "WARNING: could not verify network separation (container missing)."
  failed=1
fi

if (( failed )); then
  echo "RESULT: requires attention (no changes were made)."
  exit 1
fi
echo "RESULT: container and network checks passed (no changes were made)."
