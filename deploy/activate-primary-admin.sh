#!/usr/bin/env bash
# Manual VPS-only admin bootstrap. Requires BOTH working SMS registration
# and the registered master's password. Password never enters shell history.
set -Eeuo pipefail
cd "$(dirname "$0")"
docker compose config --quiet
python3 - <<'PY'
import getpass
import subprocess
secret = getpass.getpass('Пароль зарегистрированного ОСНОВНОГО мастера (не показывается): ')
if len(secret) < 10 or len(secret) > 128:
    raise SystemExit('Неверная длина пароля; операция остановлена')
subprocess.run([
    'docker', 'compose', 'exec', '-T', '-e', 'STAFF_BOOTSTRAP_CONFIRM=YES',
    'app', 'node', '--import', 'tsx',
    'server/src/ops/bootstrapPrimaryAdmin.ts'
], input=secret, text=True, check=True)
PY
