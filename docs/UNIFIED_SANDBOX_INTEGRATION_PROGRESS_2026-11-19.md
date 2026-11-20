# TrakSOS — единый тестовый кандидат, 19.11.2026

Это **незавершённый** интеграционный кандидат, не main, не установленная версия сайта.

Основа: `e9b890cd9ff7a94ece87d9d5d90d4d46e0c97fa6` (TrakBot, маскот, мультизаявки, модельные фотографии).
Источники следующего этапа:
- Обучение/CRM/5%+5%: PR #197, `41536381bcd550e84861cd7570ea2557a5180963`
- Счета Точка: PR #184/#194, `3a0747077c24628a950c4df46f55ca53fb9cdfd9`, включение API только после отдельных условий
- Android: PR #188/#195, `6d521405bc1815095e19d8ddf32694f8a596cef9`
- Мобильный браузер: PR #190/#196, `88eecae4378cab3b91d604db3860017a3def11fe`
- Календарь: PR #182, `ba34d8b3bc8fecf210f2de55d273752f79a1315f`

На этом шаге перенесены только файлы, для которых версия тестовой основы не расходилась с исходной веткой. Общие изменённые файлы не перезаписывались: их требуется свести по смыслу и проверить CI.

## Чисто перенесённые файлы (44)
- `scripts/load-mixed-200.mjs` ← training
- `server/src/services/chat.ts` ← training
- `server/test/flow.test.ts` ← training
- `server/test/load200.test.ts` ← training
- `server/test/service.test.ts` ← training
- `docs/ADMIN_REGISTRY_2026-11-19.md` ← training
- `docs/APPROVED_FEE_POLICY_2026-11-19.md` ← training
- `docs/ROLE_OFFERS_AND_UNIT_ECONOMICS_DRAFT_2026-11-19.md` ← training
- `docs/STO_SETTLEMENT_2026-11-19.md` ← training
- `server/migrations/119_admin_crm_registry.sql` ← training
- `server/migrations/120_service_client_fee_settlement.sql` ← training
- `server/src/services/adminRegistry.ts` ← training
- `server/test/adminRegistry.test.ts` ← training
- `server/test/feeVisibility.test.ts` ← training
- `server/test/proposedEconomics.test.ts` ← training
- `server/test/serviceFeeSettlement.test.ts` ← training
- `web/src/proposedEconomics.ts` ← training
- `web/src/screens/adminRegistry.css` ← training
- `web/src/screens/adminRegistry.tsx` ← training
- `web/src/screens/adminServiceFinance.tsx` ← training
- `web/src/screens/contextHelp.tsx` ← training
- `web/src/screens/pricingLaboratory.tsx` ← training
- `web/src/screens/roleTour.tsx` ← training
- `web/src/screens/roleTrainingPractice.tsx` ← training
- `web/src/screens/training.css` ← training
- `web/src/screens/training.tsx` ← training
- `docs/TOCHKA_API_INVOICES_2026-11-19.md` ← tochka
- `server/migrations/121_tochka_invoice_documents.sql` ← tochka
- `server/src/payments/tochkaInvoiceWorkflow.ts` ← tochka
- `server/src/payments/tochkaInvoices.ts` ← tochka
- `server/test/tochkaInvoices.test.ts` ← tochka
- `e2e/approved-truck-hero.mjs` ← android
- `e2e/premium-unified-client.mjs` ← android
- `e2e/visual-text-geometry.mjs` ← android
- `web/src/screens/search.tsx` ← android
- `e2e/android-approved-workspaces.mjs` ← android
- `web/src/androidApproved20261119.css` ← android
- `web/src/screens/androidWorkspaces.tsx` ← android
- `e2e/public-layout.mjs` ← mobileBrowser
- `e2e/public-service-routing.mjs` ← mobileBrowser
- `web/src/mobileBrowser.css` ← mobileBrowser
- `docs/PERFORMER_CALENDAR_FOUNDATION_2026-11-19.md` ← calendar
- `server/migrations/20261119_performer_time_reservations.sql` ← calendar
- `server/test/performerTimeReservations.test.ts` ← calendar

## Необъединённые пересечения (23)
- `e2e/admin-navigation-ux.mjs` ← training: staging differs from source base
- `e2e/flow.mjs` ← training: staging differs from source base
- `server/src/app.ts` ← training: staging differs from source base
- `server/src/services/orders.ts` ← training: staging differs from source base
- `server/src/services/profiles.ts` ← training: staging differs from source base
- `server/src/services/service.ts` ← training: staging differs from source base
- `server/test/referral.test.ts` ← training: staging differs from source base
- `web/src/main.tsx` ← training: staging differs from source base
- `web/src/screens/admin.tsx` ← training: staging differs from source base
- `web/src/screens/base.tsx` ← training: staging differs from source base
- `web/src/screens/help.tsx` ← training: staging differs from source base
- `web/src/screens/order.tsx` ← training: staging differs from source base
- `web/src/screens/performerCabinet.tsx` ← training: staging differs from source base
- `server/src/app.ts` ← tochka: staging differs from source base
- `server/src/config.ts` ← tochka: staging differs from source base
- `.github/workflows/ci.yml` ← android: staging differs from source base
- `e2e/flow.mjs` ← android: staging differs from source base
- `web/src/main.tsx` ← android: staging differs from source base
- `web/src/screens/client.tsx` ← android: staging differs from source base
- `web/src/screens/order.tsx` ← android: staging differs from source base
- `web/src/screens/performer.tsx` ← android: staging differs from source base
- `e2e/approved-truck-hero.mjs` ← mobileBrowser: another PR already edits the path (android)
- `web/src/main.tsx` ← mobileBrowser: staging differs from source base

## Обязательные условия до использования
- Последний утверждённый дизайн ПК/Android; старые макеты не заменяют его
- Отдельная sandbox БД, никакой связи с production PostgreSQL; миграции протестировать на disposable DB
- `PAYMENT_PROVIDER=mock`, `TOCHKA_INVOICE_ENABLED=false`, реальные SMS/push/внешний ИИ и автосписания выключены; магазин закрыт
- CI/typecheck/server tests/web build/E2E ролей/Android APK одного SHA
- Реальные маршруты через админку → мастер → заявка → чат → обратно в админку
- VPS deploy и /api/health подтвердить отдельно. Этот коммит **не означает** обновление сервера.

Дополнительные PR #108–#180 (геолокация, слабая связь, приглашение мастера, ТехБаза, гараж, финансы, админка) остаются в выпускном реестре #107 для ревизии, импорт не подтверждён.
