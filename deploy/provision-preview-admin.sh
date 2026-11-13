#!/usr/bin/env bash
# Local-only first administrator preview. Never enable an HTTP bypass or echo a fixed SMS code.
set -Eeuo pipefail
cd "$(dirname "$0")"
docker compose config --quiet
echo 'Creating a 4-hour preview password for the preconfigured ADMIN_PHONES only.'
echo 'Requires an EMPTY user database. It does not change SMS.ru, payments, or shop settings.'
echo 'Do NOT share a screenshot containing the password.'
docker compose exec -T -e STAFF_PREVIEW_BOOTSTRAP_CONFIRM=YES app \
  node --import tsx server/src/ops/provisionPreviewAdmin.ts
