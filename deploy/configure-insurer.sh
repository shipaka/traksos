#!/usr/bin/env bash
# Private one-time insurance agent phone setup. Never echoes phone or edits GitHub.
set -Eeuo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "Нет закрытого файла deploy/.env"; exit 1; }
python3 - <<'PY'
import getpass
import os
import pathlib
import re
import tempfile

p = pathlib.Path('.env')
phone = getpass.getpass('Номер ЕДИНСТВЕННОГО первого страхового агента (+79XXXXXXXXX): ').strip()
if not re.fullmatch(r'\+79\d{9}', phone):
    raise SystemExit('Ошибка формата. Введите +79XXXXXXXXX, конфигурация не изменена.')
lines = p.read_text().splitlines()
env = {}
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
for key in ('ADMIN_PHONES', 'MODERATOR_PHONES', 'RECOVERY_CONTACT_PHONE'):
    if phone in [x.strip() for x in env.get(key, '').split(',') if x.strip()]:
        raise SystemExit('Номер уже закреплён за другой служебной ролью; никаких изменений нет.')
old = env.get('INSURER_PRIMARY_PHONE', '')
if old and old != phone:
    raise SystemExit('Страховой номер уже закреплён. Замена требует отдельной проверки существующего агента, никаких изменений нет.')
result = []
done = False
for line in lines:
    if line.startswith('INSURER_PRIMARY_PHONE='):
        if not done:
            result.append('INSURER_PRIMARY_PHONE=' + phone)
            done = True
    else:
        result.append(line)
if not done:
    result.append('INSURER_PRIMARY_PHONE=' + phone)
fd, tmp = tempfile.mkstemp(prefix='.env.insurer-', dir='.')
try:
    with os.fdopen(fd, 'w') as f:
        f.write('\n'.join(result) + '\n')
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
print('OK: первый страховой номер закреплён конфиденциально в deploy/.env.')
print('Номер не выводился. Изменение вступит в силу после обновления app-контейнера.')
PY
