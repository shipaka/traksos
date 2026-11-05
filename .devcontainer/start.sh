#!/bin/bash
# Запуск стенда: свежий код, сборка, тестовые данные, сервер на порту 8080.
cd /workspaces/traksos
git pull --ff-only 2>/dev/null; npm install --silent; npm run build --silent
export PUBLIC_URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export CORS_ORIGINS="$PUBLIC_URL"
until (echo > /dev/tcp/db/5432) 2>/dev/null; do sleep 1; done
npm -w server run seed
pkill -f "server/src/main.ts" 2>/dev/null
# setsid — чтобы codespace не убил сервер, когда стартовый скрипт закончится
setsid nohup node --import tsx server/src/main.ts > /tmp/traksos.log 2>&1 < /dev/null &
# Открыть ссылку и для телефона (без входа в GitHub): ждём, пока сервер займёт порт, и пробуем несколько раз
for i in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/8080) 2>/dev/null && break; sleep 1; done
for i in 1 2 3 4 5; do
  gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>&1 && { echo "Порт 8080 открыт для телефона"; break; }
  sleep 5
done
echo "ТракSOS запущен: $PUBLIC_URL"
