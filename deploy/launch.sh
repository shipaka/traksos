#!/usr/bin/env bash
# TrackSOS: запуск пилотного стенда на Ubuntu VPS с Docker Compose.
# Запуск: sudo bash deploy/launch.sh
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then
  echo "Запустите с sudo: sudo bash deploy/launch.sh" >&2
  exit 1
fi
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE"
DOMAIN="${TRACKSOS_DOMAIN:-traksos.ru}"
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "Недопустимый домен: $DOMAIN" >&2; exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Нужны Docker Engine и Compose plugin. Официальная инструкция:"
  echo "https://docs.docker.com/engine/install/ubuntu/"
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "Первый запуск. .env с секретами будет создан только на VPS."
  read -r -p "Телефон администратора (+7XXXXXXXXXX): " ADMIN_NUMBER
  if [[ ! "$ADMIN_NUMBER" =~ ^\+7[0-9]{10}$ ]]; then
    echo "Нужен корректный номер +7XXXXXXXXXX"; exit 1
  fi
  umask 077
  cp .env.example .env
  DBPW="$(openssl rand -hex 24)"
  SECRET="$(openssl rand -hex 32)"
  export DOMAIN ADMIN_NUMBER DBPW SECRET
  python3 - <<'PY'
from pathlib import Path
import os
p=Path('.env')
s=p.read_text()
for name, value in {
    'DOMAIN': os.environ['DOMAIN'],
    'DB_PASSWORD': os.environ['DBPW'],
    'APP_SECRET': os.environ['SECRET'],
    'ADMIN_PHONES': os.environ['ADMIN_NUMBER'],
}.items():
    import re
    s = re.sub(r'^' + re.escape(name) + r'=.*$', lambda _: name + '=' + value, s, flags=re.MULTILINE)
p.write_text(s)
PY
  chmod 600 .env
else
  echo "Существующий deploy/.env не изменён."
fi
echo "Проверка Docker Compose..."
docker compose config --quiet
echo "Сборка актуального кода и запуск..."
docker compose up -d --build
echo "Контейнеры:"
docker compose ps
echo "Готово: после настройки A-записи DNS и HTTPS проверяйте https://$DOMAIN/api/health"
echo "Пока SMS_PROVIDER=log, публичная регистрация и восстановление пароля по SMS не работают: подключите SMS.ru до подключения реальных людей."
echo "Пока PAYMENT_PROVIDER=mock, реальную оплату не включайте. Проверьте, что ежедневный backup успешно создаёт .dump и внешний снимок VPS настроен."
