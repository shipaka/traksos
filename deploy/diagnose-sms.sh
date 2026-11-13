#!/usr/bin/env bash
# Read-only SMS provider check: never prints phone numbers, codes or API keys.
set -Eeuo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import re
import subprocess

result = subprocess.run(
    ['docker','compose','logs','--no-color','--since','3h','--tail','400','app'],
    capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Не удалось прочитать журнал приложения')
lines = [line for line in result.stdout.splitlines()
         if 'SMS.ru не принял сообщение:' in line]
if not lines:
    print('Явных отказов SMS.ru в последних 400 строках за 3 часа нет.')
    print('Это не исключает сетевые ошибки или недоставленное SMS.')
else:
    print('Отказов SMS.ru в доступной части журнала:', len(lines))
    last = lines[-1].split('SMS.ru не принял сообщение:',1)[1].lower()
    if any(word in last for word in ('баланс','balance','недостаточно','money','funds')):
        category = 'Недостаточный баланс SMS.ru'
    elif any(word in last for word in ('api_id','авторизац','ключ','api key','authorization')):
        category = 'Ошибка авторизации SMS.ru'
    elif any(word in last for word in ('отправител','sender','подпись')):
        category = 'Ограничения отправителя / подписи'
    elif any(word in last for word in ('лимит','limit','quota','слишком много')):
        category = 'Ограничение отправок'
    elif any(word in last for word in ('номер','phone','number','запрещ','blocked','recipient')):
        category = 'Номер или ограничение получателя'
    else:
        category = 'Другая причина, подробности проверьте в кабинете SMS.ru'
    print('Категория последнего отказа:', category)
print('Номера телефонов и SMS-коды не выводились.')
PY
