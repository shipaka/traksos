#!/usr/bin/env bash
# Run on the VPS after the protected primary phone has registered as a master.
# Does not print phones, codes, passwords or other .env values.
set -Eeuo pipefail
cd "$(dirname "$0")"
docker compose config --quiet
docker compose exec -T -e STAFF_BOOTSTRAP_CONFIRM=YES app   node --import tsx server/src/ops/bootstrapPrimaryAdmin.ts
