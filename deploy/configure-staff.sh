#!/usr/bin/env bash
# Interactive VPS-only staff phone configuration. Never prints or logs numbers.
set -Eeuo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "Missing private deploy/.env"; exit 1; }
python3 - <<'PY'
import getpass
import os
import pathlib
import re
import tempfile
p = pathlib.Path('.env')
def ask(label):
    value = getpass.getpass(label).strip()
    if not re.fullmatch(r'\+79\d{9}', value):
        raise SystemExit('Ожидается номер +79XXXXXXXXX, настройки не изменены')
    return value

print('Введите три номера в терминале VPS. Они НЕ выводятся и НЕ сохраняются в GitHub.')
primary = ask('Номер ОСНОВНОГО администратора: ')
moderator = ask('Номер модератора/мастера: ')
recovery = ask('Запасной контакт для ручного восстановления: ')
if len({primary, moderator, recovery}) != 3:
    raise SystemExit('Номера должны различаться; настройки не изменены')
keys = {
    'ADMIN_PHONES': primary,
    'MODERATOR_PHONES': moderator,
    'RECOVERY_CONTACT_PHONE': recovery,
}
lines = p.read_text().splitlines()
new_lines = []
seen = set()
for line in lines:
    key = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
    if key in keys:
        if key not in seen:
            new_lines.append(key + '=' + keys[key])
            seen.add(key)
    else:
        new_lines.append(line)
for key, value in keys.items():
    if key not in seen:
        new_lines.append(key + '=' + value)
fd, tmp = tempfile.mkstemp(dir='.', prefix='.env.staff-')
try:
    with os.fdopen(fd, 'w') as file:
        file.write('\n'.join(new_lines) + '\n')
        file.flush()
        os.fsync(file.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
print('OK: ограниченные номера записаны в deploy/.env. Значения скрыты.')
print('ВНИМАНИЕ: применятся к приложению только при обновлении контейнера.')
PY
