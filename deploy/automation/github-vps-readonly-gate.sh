#!/usr/bin/env bash
# TrakSOS VPS bridge: deliberately READ-ONLY. Intended exclusively as the
# forced command for a dedicated GitHub Actions SSH public key.
# Do NOT use this key as a shell/root login key or for general deployment.
set -Eeuo pipefail
umask 077
export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export LC_ALL=C

if [[ "${SSH_ORIGINAL_COMMAND:-}" != "status" ]]; then
  echo "DENIED: only the exact 'status' operation is permitted." >&2
  exit 64
fi
if [[ ! -d /root/traksos/.git ]]; then
  echo "ERROR: /root/traksos checkout is missing." >&2
  exit 1
fi
echo "TRAKSOS_VPS_HOSTNAME=$(hostname)"
printf "TRAKSOS_CHECKOUT_SHA="
git -C /root/traksos rev-parse HEAD
printf "TRAKSOS_CHECKOUT_BRANCH="
git -C /root/traksos symbolic-ref --short HEAD || true

# Docker details are limited to container names and health state. Never output
# environment variables, credentials, connection strings or logs.
echo "TRAKSOS_DOCKER_SERVICES:"
docker ps --format '{{.Names}} | {{.Status}}' |
  grep -E '^(deploy-(app|db|caddy|backup)-1|traksos-test-sandbox-(app|db)-1) ' || true

# Public endpoint. Allowlist only non-sensitive fields.
echo "TRAKSOS_PUBLIC_HEALTH:"
curl --silent --show-error --fail --max-time 12 https://traksos.ru/api/health |
  python3 -c 'import sys,json; d=json.load(sys.stdin); print("ok=%s db=%s sandbox=%s revision=%s" % (d.get("ok"),d.get("db"),d.get("sandbox"),d.get("buildRevision","unknown")))'
