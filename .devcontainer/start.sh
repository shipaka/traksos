#!/bin/bash
# Запуск стенда: свежий код, сборка, тестовые данные, сервер на порту 8080.
cd /workspaces/traksos
echo "ТракSOS: текущая ветка $(git branch --show-current), коммит $(git rev-parse --short HEAD)"
if ! git pull --ff-only; then
  echo "ВНИМАНИЕ: не удалось обновить код. Проверьте ветку и запустите новый Codespace по ссылке в README."
fi
echo "Сборка версии $(git rev-parse --short HEAD)"
npm install --silent || exit 1
npm run build || exit 1
export PUBLIC_URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export CORS_ORIGINS="$PUBLIC_URL"
until (echo > /dev/tcp/db/5432) 2>/dev/null; do sleep 1; done
npm -w server run seed
pkill -f "server/src/main.ts" 2>/dev/null
# setsid — чтобы codespace не убил сервер, когда стартовый скрипт закончится
setsid nohup node --import tsx server/src/main.ts > /tmp/traksos.log 2>&1 < /dev/null &
# gh нужен, чтобы открыть порт для телефона; в образе его нет — ставим один раз (после пробуждения порт снова Private)
if ! command -v gh >/dev/null; then
  V=2.62.0; mkdir -p "$HOME/.local/bin"
  curl -fsSL "https://github.com/cli/cli/releases/download/v$V/gh_${V}_linux_amd64.tar.gz" | tar -xz -C /tmp \
    && cp "/tmp/gh_${V}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"
  export PATH="$HOME/.local/bin:$PATH"
fi
# Открыть ссылку и для телефона (без входа в GitHub): ждём, пока сервер займёт порт, и пробуем несколько раз
for i in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/8080) 2>/dev/null && break; sleep 1; done
for i in 1 2 3 4 5; do
  gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>&1 && { echo "Порт 8080 открыт для телефона"; break; }
  sleep 5
done
command -v gh >/dev/null || echo "ВНИМАНИЕ: gh не установился — откройте вкладку «Порты» и сделайте 8080 Public вручную"
echo "ТракSOS запущен: $PUBLIC_URL"
