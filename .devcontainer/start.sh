#!/bin/bash
# Запуск стенда: свежий код, сборка, тестовые данные, сервер на порту 8080.
cd /workspaces/traksos
git pull --ff-only 2>/dev/null && npm install --silent && npm run build --silent
export PUBLIC_URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export CORS_ORIGINS="$PUBLIC_URL"
until (echo > /dev/tcp/db/5432) 2>/dev/null; do sleep 1; done
npm -w server run seed
pkill -f "server/src/main.ts" 2>/dev/null
nohup node --import tsx server/src/main.ts > /tmp/traksos.log 2>&1 &
# Открыть ссылку и для телефона (без входа в GitHub)
gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" 2>/dev/null || true
echo "ТракSOS запущен: $PUBLIC_URL"
