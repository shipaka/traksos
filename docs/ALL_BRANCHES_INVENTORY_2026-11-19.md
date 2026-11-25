# TrakSOS: полный реестр GitHub веток на 19.11.2026

**Снимок инвентаризации:** 146 существующих веток, 140 видимых PR из первых двух страниц. Это **метаданные**, не доказательство интеграции каждой ветки. Ничего не удалять до просмотра diff и обратной совместимости.

**Актуальная единая ветка:** [PR #199](https://github.com/shipaka/traksos/pull/199). Старые дизайны (особенно 14.11.2026) не имеют права заменить решения 19.11. Текущие PNG-референсы и маршруты описаны в [действующем каноне](DESIGN_CANON_LATEST_2026-11-19.md). 

**Приоритет проверки недостающей функции:** роли/все кликабельные плитки и история, ТехБаза/Эфир/коды/обучение, гараж/каталог техники/фото, слабая связь/SOS/адрес трассы, многозаявки и статусы, финансовая видимость 5%+5%, Точка без live, Android и мобильный браузер.

Важно: слово «архив» в таблице относится **только к визуальному оформлению**, а не к безопасным багфиксам/работающей серверной логике в той же ветке. Код не надо считать завершённым до реальной проверки. 

| Ветка | HEAD SHA | Связанные PR | Решение для ревизии |
|---|---|---|---|
| `auction` | `37488c84613f` | — | Сверить diff и условия |
| `automation/isolated-sandbox-image-gate-20261117` | `f5585b2634e3` | #130 closed | Связи/релиз-гейты; не слепой merge |
| `automation/sandbox-remote-diagnostics-20261117` | `1d0fcb3e983a` | #128 closed | Связи/релиз-гейты; не слепой merge |
| `automation/scheduled-vps-health-20261117` | `f8e756a839b5` | #129 closed | Связи/релиз-гейты; не слепой merge |
| `chore/runtime-image-trim-20261114` | `795e05d05e7a` | #54 closed draft | Архив визуала; не переносить дизайн |
| `design/future-proof-role-workspaces-20261117` | `a5dce490a858` | #121 open draft | Архив визуала; не переносить дизайн |
| `design/guest-desktop-coverage-20261118` | `9f3be7a6fc24` | #156 open draft | Архив визуала; не переносить дизайн |
| `design/mobile-browser-responsive-20261119` | `88eecae4378c` | #196 closed, #190 open | Архив визуала; не переносить дизайн |
| `docs/agent-tax-registers-20261117` | `7cbeed30655e` | #124 open draft | Финансы: только безопасная сверка, без live |
| `docs/next-chat-server-handoff-20261113` | `55fae4d5e4e0` | #17 closed | Сверить diff и условия |
| `docs/release-ai-preflight-20261119` | `10df22b832fc` | #177 open draft | Связи/релиз-гейты; не слепой merge |
| `docs/single-workboard-20261116` | `9277dfdcd37d` | #106 closed | Сверить diff и условия |
| `feat/admin-full-role-sandbox-20261113` | `5c1cab6c5eaf` | #28 closed draft | Связи/релиз-гейты; не слепой merge |
| `feat/admin-role-integration-20261114` | `1168d0494e59` | #42 closed draft | Архив визуала; не переносить дизайн |
| `feat/android-yandex-seasonal-splash-20261114` | `2c4e13183961` | — | Архив визуала; не переносить дизайн |
| `feat/cabinet-design-unified-20261114` | `10f199ae0bdc` | #59 closed draft | Архив визуала; не переносить дизайн |
| `feat/cabinet-premium-visual-review-20261114` | `5751ffded55b` | #32 closed draft | Архив визуала; не переносить дизайн |
| `feat/cabinets-visual-mobile-domain-20261113` | `ca115fc69ac7` | #26 closed | Сверить diff и условия |
| `feat/guest-entry-role-previews-20261115` | `3a4cffb466a6` | #79 closed, #78 closed draft | Сверить diff и условия |
| `feat/insurer-real-empty-dashboard-20261113` | `a2472f7a2f6b` | #27 closed | Сверить diff и условия |
| `feat/isolated-real-cabinet-sandbox-20261115` | `81cdb6b4881e` | #89 closed draft | Связи/релиз-гейты; не слепой merge |
| `feat/partner-role-art-and-highres-hero-20261115` | `d73242079c24` | #84 closed | Сверить diff и условия |
| `feat/real-insurer-preview-20261113` | `2f5e591e73bb` | #25 closed draft | Сверить diff и условия |
| `feat/real-service-cabinet-sandbox-20261113` | `91f9742e6a7d` | #24 closed | Связи/релиз-гейты; не слепой merge |
| `feat/sos-progressive-eta-issue51-20261117` | `59a6121be7b8` | #149 closed | Сверить diff и условия |
| `feat/techbase-curated-sources-20261118` | `71d2f5eaa1b7` | #159 open draft | Сверка актуальной функции и прав |
| `feat/temporary-readonly-demo-access-20261115` | `da9e749fc2d9` | #81 closed | Сверить diff и условия |
| `feat/tochka-invoices-api-20261119` | `3a0747077c24` | #194 closed, #184 open draft | Финансы: только безопасная сверка, без live |
| `feat/warranty-claims-review-20261114` | `9f8e2d596c4c` | #68 closed draft | Архив визуала; не переносить дизайн |
| `feat/warranty-recourse-register-20261114` | `34255085293f` | #70 closed draft | Архив визуала; не переносить дизайн |
| `feat/warranty-rework-execution-20261114` | `6be095038f88` | #69 closed draft | Архив визуала; не переносить дизайн |
| `feature/admin-assisted-registration-20261116` | `07c862e6837f` | #97 closed | Сверить diff и условия |
| `feature/admin-case-center-20261118` | `bd71ba9329e2` | #162 open draft | Сверить diff и условия |
| `feature/admin-sandbox-test-center-20261113` | `2ba9177e6e50` | #16 closed | Связи/релиз-гейты; не слепой merge |
| `feature/android-approved-ui-2026-11-19` | `6d521405bc18` | #195 closed, #188 open draft | Сверить diff и условия |
| `feature/android-pin-biometric-entry-20261116` | `674bc5decf8b` | #108 open draft | Сверить diff и условия |
| `feature/checkpoint-arrival-evidence-20261117` | `c1a7c5b7a1a5` | #144 open | Сверить diff и условия |
| `feature/cinematic-role-cabinets-20261116` | `a30a22f77c24` | #112 open draft | Архив визуала; не переносить дизайн |
| `feature/community-air-mobile-foundation-20261116` | `3189b7fe4210` | — | Сверка актуальной функции и прав |
| `feature/community-techbase-master-sto-only-20261117` | `186e6c503046` | #151 open draft | Сверка актуальной функции и прав |
| `feature/developer-report-delivery-20261116` | `414d8e629d63` | #98 closed | Сверить diff и условия |
| `feature/dispatch-console-and-ether-voice-preview` | `d3d89253e7f5` | — | Сверка актуальной функции и прав |
| `feature/dispatcher-operations-20261118` | `60e3e430aeae` | — | Сверить diff и условия |
| `feature/driver-air-live-traksbot-20261119` | `9b4001e451c0` | #176 open draft | Сверка актуальной функции и прав |
| `feature/guest-handoff-consent-pilot-20261118` | `511eec111d84` | — | Сверить diff и условия |
| `feature/insurance-home-and-queue-20261116` | `8d8a70300bb9` | #102 closed | Сверить diff и условия |
| `feature/insurance-mobile-next-action-20261116` | `7f2f8e874156` | #104 closed | Сверить diff и условия |
| `feature/insurance-offers-conversation-20261113` | `b7c251dab9ef` | #23 closed | Сверить diff и условия |
| `feature/insurance-premium-states-20261116` | `9a5619b85c73` | #101 closed | Сверить diff и условия |
| `feature/insurance-single-agent-locked-registration-20261113` | `cede8f82cc7b` | #15 closed | Финансы: только безопасная сверка, без live |
| `feature/model-photos-license-plates-20261119` | `1e055e16dbe8` | #187 open draft | Сверить diff и условия |
| `feature/multicase-ecu-and-parallel-20261118` | `bcd3168d8831` | #169 open draft | Сверить diff и условия |
| `feature/order-sla-offline-resilience-20261118` | `92aa51941ec1` | #163 open draft | Сверить diff и условия |
| `feature/performer-calendar-foundation-20261119` | `ba34d8b3bc8f` | #182 open draft | Сверить diff и условия |
| `feature/preferred-performer-direct-invite-20261118` | `7dd956ae8b4d` | #165 open draft | Сверить diff и условия |
| `feature/realistic-sandbox-cabinets-20261113` | `2cc7f0365704` | #22 closed | Связи/релиз-гейты; не слепой merge |
| `feature/release-vehicle-experience-community-20261117` | `4f37d962a610` | #152 open draft | Сверка актуальной функции и прав |
| `feature/roadside-km-evidence-20261118` | `e98cb981d8c5` | #164 open draft | Сверить diff и условия |
| `feature/role-training-offers-2026-11-19` | `4f8419f7391a` | #193 closed, #183 open draft | Сверить diff и условия |
| `feature/sandbox-preview-independent-release-20261117` | `f3a3e902b06e` | #131 closed | Связи/релиз-гейты; не слепой merge |
| `feature/secure-vps-admin-preview-20261113` | `6a3721e4e648` | #18 closed | Связи/релиз-гейты; не слепой merge |
| `feature/shop-agency-evidence-ledger-20261117` | `a8773e7f2942` | #139 open | Сверка актуальной функции и прав |
| `feature/shop-agent-evidence-ledger-20261117` | `ae7c6faa963e` | #141 closed draft | Сверка актуальной функции и прав |
| `feature/shop-agent-ledger-core-20261117` | `ee501f51c473` | #138 open draft | Сверка актуальной функции и прав |
| `feature/shop-catalog-bulk-import-20261113` | `d290c34bb654` | #13 closed | Сверка актуальной функции и прав |
| `feature/shop-catalog-history-low-data-20261113` | `090836982e76` | #7 closed | Сверка актуальной функции и прав |
| `feature/shop-incremental-catalog-20261113` | `315da89e7617` | #9 closed | Сверка актуальной функции и прав |
| `feature/shop-reference-offline-20261113` | `910109b3bc6a` | #14 closed | Сверка актуальной функции и прав |
| `feature/shop-supplier-sku-mapping-20261113` | `58cf42b8bba7` | #10 closed | Сверка актуальной функции и прав |
| `feature/track-sos-ops-release-candidate-20261118` | `07497d3c7559` | #168 open draft | Связи/релиз-гейты; не слепой merge |
| `feature/track-sos-pilot-backlog-integration-20261118` | `b9314ead0d73` | #167 open draft | Связи/релиз-гейты; не слепой merge |
| `feature/tracksos-community-ecosystem-20261116` | `bbb58d17585c` | #111 open draft | Сверка актуальной функции и прав |
| `feature/trakbot-mascot-tech-v3-30-reactions` | `eb12461d9f68` | #192 closed, #189 open draft | Сверить diff и условия |
| `feature/trakbot-private-dtc-20261119` | `350c20ae768f` | #191 closed, #185 open draft | Сверить diff и условия |
| `feature/unilateral-close-offline-20261118` | `25cc34138b33` | #175 open draft | Сверить diff и условия |
| `feature/unilateral-close-safe-20261119` | `05825507f97d` | #178 closed draft | Сверить diff и условия |
| `feature/vehicle-extra-details-permission-20261118` | `542b955544bf` | #166 open draft | Сверка актуальной функции и прав |
| `feature/vehicle-insurance-workflows` | `9b5187ff8fbc` | #1 closed draft | Сверка актуальной функции и прав |
| `feature/vehicle-owners-guides-trailers-recovery-20261117` | `e1fc21f68714` | #150 open draft | Сверка актуальной функции и прав |
| `feature/vehicle-reference-versioned-20261117` | `a7da7e01f1de` | #143 open | Сверка актуальной функции и прав |
| `fix/admin-master-cabinet-switch-20261113` | `583f90a7a9fd` | #5 closed | Сверить diff и условия |
| `fix/admin-report-live-status-20261116` | `7790d667f5b1` | #99 closed | Сверить diff и условия |
| `fix/android-preview-side-by-side-20261114` | `c5ebe667b54c` | #75 closed | Архив визуала; не переносить дизайн |
| `fix/approved-mobile-layout-20261113` | `88050208e1b5` | #2 closed | Сверить diff и условия |
| `fix/auth-inbound-flashcall-otp-release-20261118` | `040d499e438e` | #158 closed | Безопасность: отдельная проверка |
| `fix/cabinet-ux-navigation-audit-20261113` | `f8f9885c6bcb` | #29 closed draft | Сверить diff и условия |
| `fix/case-receipts-and-review-20261114` | `4cb6ec283fa5` | #40 closed draft | Архив визуала; не переносить дизайн |
| `fix/client-active-orders-bookings-issue36-20261117` | `b40ff297160b` | — | Сверить diff и условия |
| `fix/client-active-orders-bookings-issue36-main-20261117` | `5e34fbc2bd14` | #142 closed | Сверить diff и условия |
| `fix/client-demo-auth-shell-20261115` | `35e429e0400e` | #86 closed draft | Безопасность: отдельная проверка |
| `fix/closed-chat-and-search-ux-20261114` | `b58c5f2f4111` | #38 closed draft | Архив визуала; не переносить дизайн |
| `fix/closed-order-chat-issue34-20261117` | `2614e0b3c654` | #140 closed | Сверить diff и условия |
| `fix/consult-no-silent-payment-20261119` | `3731ad4b2655` | #180 open draft | Финансы: только безопасная сверка, без live |
| `fix/durable-callout-hold-20261114` | `47b328a2980c` | #66 closed draft | Архив визуала; не переносить дизайн |
| `fix/durable-cancellation-payments-20261114` | `c15b8f13658d` | #60 closed draft | Архив визуала; не переносить дизайн |
| `fix/durable-capture-reconcile-20261114` | `c5558a184f5c` | #57 closed draft | Архив визуала; не переносить дизайн |
| `fix/durable-work-payment-create-20261114` | `ce72e83503be` | #64 closed draft | Архив визуала; не переносить дизайн |
| `fix/ecu-diagnostic-consent-prework-20261118` | `02ba5741a0e3` | #155 closed | Сверить diff и условия |
| `fix/hero-map-auth-navigation-20261115` | `c02975aa748f` | — | Безопасность: отдельная проверка |
| `fix/http-bearer-query-leak-20261118` | `613bc5a675f7` | #160 open draft | Сверить diff и условия |
| `fix/invoice-refund-manual-20261114` | `b33d74db30e7` | #53 closed draft | Архив визуала; не переносить дизайн |
| `fix/landing-hero-map-auth-nav-menus-20261115` | `5c57ee486fb2` | #83 closed | Безопасность: отдельная проверка |
| `fix/limited-fleet-user-demo-role-20261115` | `e22cfd45a111` | — | Сверить diff и условия |
| `fix/mobile-toast-brand-overlap-20261116` | `0c426c2c99c5` | #103 closed | Сверить diff и условия |
| `fix/navigation-reentry-2026-11-14` | `318179c5a05b` | #71 closed draft | Архив визуала; не переносить дизайн |
| `fix/notifications-mark-one-20261119` | `98fea909da24` | #179 open draft | Сверить diff и условия |
| `fix/p0-auth-entry-visible-errors-20261117` | `f0798c8499c4` | #127 closed | Безопасность: отдельная проверка |
| `fix/partner-cabinet-mobile-polish-20261114` | `f5606da248d9` | #43 closed draft | Архив визуала; не переносить дизайн |
| `fix/payment-retry-concurrency-20261114` | `7ea25361bc51` | #46 closed draft | Архив визуала; не переносить дизайн |
| `fix/performer-request-settings-issue35-20261117` | `9c37f5680488` | #145 closed | Сверить diff и условия |
| `fix/performer-request-settings-ux-20261114` | `cd1ef51eff10` | #39 closed draft | Архив визуала; не переносить дизайн |
| `fix/preview-admin-audit-uuid-20261113` | `e7a24bef4aa0` | #21 closed | Сверить diff и условия |
| `fix/preview-admin-browser-check-20261113` | `71d0196dd66e` | #20 closed | Сверить diff и условия |
| `fix/public-landing-tiles-carousel-icons-20261115` | `4b3a661e06e3` | #80 closed | Сверить diff и условия |
| `fix/role-nav-sos-direct-20261114` | `b845f06452bf` | #55 closed draft | Архив визуала; не переносить дизайн |
| `fix/role-preview-mobile-flow-20261113` | `b37aa33408bc` | #30 closed draft | Сверить diff и условия |
| `fix/sms-rejection-cooldown-20261113` | `7f9bb6c1ff7a` | #8 closed | Безопасность: отдельная проверка |
| `fix/sos-early-cancel-race-20261114` | `098474908af8` | #67 closed draft | Архив визуала; не переносить дизайн |
| `fix/sos-region-coverage-issue113-20261117` | `fb31bc452e59` | #148 closed | Сверить diff и условия |
| `fix/support-first-reply-sla-20261114` | `be0f5896a488` | #56 closed draft | Архив визуала; не переносить дизайн |
| `fix/webhook-once-ledger-20261114` | `0fd7426e9340` | #48 closed draft | Архив визуала; не переносить дизайн |
| `infra/sandbox-deploy-readonly-preflight-20261117` | `b4011b789281` | #136 closed | Связи/релиз-гейты; не слепой merge |
| `integration/backend-payment-support-20261114` | `22d8fd0ff7a5` | #63 closed draft | Архив визуала; не переносить дизайн |
| `integration/insurance-20261113` | `5f169fd35a4f` | #3 closed | Связи/релиз-гейты; не слепой merge |
| `integration/main-feature89-20261116` | `d8879b01d7d4` | — | Связи/релиз-гейты; не слепой merge |
| `integration/multicase-unilateral-20261119` | `1cfa679f701c` | #181 open draft | Связи/релиз-гейты; не слепой merge |
| `integration/pr111-split-map-20261117` | `3f93dd19fa05` | #137 closed | Связи/релиз-гейты; не слепой merge |
| `integration/pr72-safe-backend-63-70-20261114` | `0e921c89a7b1` | #73 closed draft | Архив визуала; не переносить дизайн |
| `integration/pr73-seasonal-weather-20261114` | `56eca7ec10fd` | #74 closed | Архив визуала; не переносить дизайн |
| `integration/pr89-58-reconciled-20261116` | `25ac92bd1ead` | #105 closed | Связи/релиз-гейты; не слепой merge |
| `integration/resolve-training-20261119` | `41536381bcd5` | #197 closed | Связи/релиз-гейты; не слепой merge |
| `integration/sandbox-unified-20261119` | `9604db621ff0` | #199 open draft | КАНДИДАТ |
| `integration/sandbox-walkthrough-2026-11-19` | `2861cdfc1b6b` | — | Связи/релиз-гейты; не слепой merge |
| `integration/sandbox-week-20261119` | `bbfd0d50a255` | #198 open draft | Связи/релиз-гейты; не слепой merge |
| `main` | `2861cdfc1b6b` | — | Сверить diff и условия |
| `release/safe-vps-update-20261113` | `eb0055a6e116` | #4 closed | Связи/релиз-гейты; не слепой merge |
| `release/track-2026-11-14-unified-candidate` | `e5f527950e99` | #72 closed | Архив визуала; не переносить дизайн |
| `review/cabinet-visual-frozen-20261114` | `75210f61aea7` | #33 closed draft | Архив визуала; не переносить дизайн |
| `security/staff-phone-guard-20261113` | `f1fac1082f8b` | #6 closed | Безопасность: отдельная проверка |
| `security/ws-onetime-tickets-phase1-20261117` | `eb1bc2452d08` | #146 closed | Безопасность: отдельная проверка |
| `test/backend-200-on-payment-stack-20261114` | `06f9e6b86176` | #62 closed draft | Архив визуала; не переносить дизайн |
| `test/backend-mixed-200-users-20261114` | `f6a932111559` | #45 closed draft | Архив визуала; не переносить дизайн |
| `test/concurrency-integrity-200-users-20261114` | `9fccf9d85124` | #44 closed draft | Архив визуала; не переносить дизайн |
| `test/financial-webhook-refund-races-issue47-20261117` | `ed2119bb2ec7` | #147 closed | Финансы: только безопасная сверка, без live |
| `test/temporary-demo-entry-e2e-20261116` | `a147a378f279` | #100 closed | Сверить diff и условия |
| `tow-auction` | `393b85167c94` | — | Сверить diff и условия |

**Дальнейшая ревизия:** сверить для каждой актуальной ветки дифф с `main`, перекрытия с единым кандидатом и конечные маршруты/API; только затем точечно включать. Никаких массовых merges с возрождением старого дизайна. Итоговый CI и sandbox привязывать к одному точному SHA.
