#!/usr/bin/env bash
# The public #/preview page is retired. Do not issue unusable grants or mutate
# the database from an obsolete operational entry point.
set -Eeuo pipefail
printf '%s\n' \
  'Старый публичный просмотр #/preview закрыт. Код не создан.' \
  'Войдите обычным администратором через #/login и откройте «Тестирование кабинетов».' \
  'Для реальных учебных операций нужен настроенный изолированный sandbox.' \
  'Инструкция: deploy/FULL_FIDELITY_SANDBOX.md' >&2
exit 1
