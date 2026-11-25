# КПП / GPS: статус переноса на 25.11.2026

PR #144. Исходный полный код: `c1a7c5b7a1a58db41f9ed580111f470ed5119daf` (сохранён как родитель интеграционного коммита; не удалён из истории). Основа: `fa7d533ebfe84958e6d336c9a96d16cd8f62170e`. Старые успешные проверки не удостоверяют новую сборку.

## Этап 1 — независимое ядро

Перенесён чистый вычислитель checkpointEvidenceCore.ts с исходными пятью изолированными тестами и дополнительной проверкой повторных/будущих отметок. Используется актуальная функция haversineKm. Результат — только candidate или needs_review, startBilling всегда false. Код не подключён к действующим запросам, не собирает GPS и не изменяет заявки.

## Не перенесено на этом этапе

Следующие пути исходной ветки остаются доступными по исходному SHA. Полный тест checkpointEvidence.test.ts включает ещё серверную интеграцию, которую не объявляем выполненной.

- `.github/workflows/checkpoint-ui-smoke.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/load-1000.yml`
- `docs/CHECKPOINT_ARRIVAL_EVIDENCE_2026-11-17.md`
- `e2e/checkpoint-sandbox-ui.mjs`
- `scripts/load-mixed-1000.mjs`
- `server/migrations/210_checkpoint_arrival_evidence.sql`
- `server/migrations/211_checkpoint_gps_scoped_consent.sql`
- `server/migrations/212_checkpoint_gps_purge_receipts.sql`
- `server/migrations/213_checkpoint_evidence_scope_constraints.sql`
- `server/migrations/214_checkpoint_route_order_scope.sql`
- `server/src/app.ts`
- `server/src/http/checkpointRoutes.ts`
- `server/src/services/checkpointEvidence.ts`
- `server/src/services/checkpointIntegrity.ts`
- `server/src/services/profiles.ts`
- `server/test/checkpointApi.test.ts`
- `server/test/checkpointEvidence.test.ts`
- `server/test/checkpointIntegrity.test.ts`
- `web/src/screens/admin.tsx`
- `web/src/screens/adminCheckpointSandbox.tsx`
- `web/src/screens/checkpointSandbox.tsx`
- `web/src/screens/order.tsx`

Порядок: проверить миграции и актуальные схемы; перенести сервисы/ограничения согласия/удаления; подключить только изолированный sandbox; проверить полномочия, браузер, Android, нагрузку 200/1000. Никакого автоматического прибытия, тарифа ожидания или боевого сбора данных. PR остаётся draft до полного согласованного этапа и свежего CI.
