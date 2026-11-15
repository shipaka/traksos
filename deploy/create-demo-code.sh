#!/usr/bin/env bash
# SSH-only: create one temporary, single-use code to the fictional cabin preview.
set -Eeuo pipefail
cd "$(dirname "$0")"
docker compose config --quiet
docker compose exec -T -e OPERATOR_DEMO_CONFIRM=YES app \
  node --import tsx server/src/ops/provisionOperatorDemo.ts
