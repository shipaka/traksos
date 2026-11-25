# Agency evidence ledger — staged integration, not a release

Existing PR #139 is the canonical model, not alternative #138. Historical source a8773e7f294276042a31600a13847f8a7bfbeb55 is preserved as an ancestor. Current integration base fa7d533ebfe84958e6d336c9a96d16cd8f62170e. All historical files are recoverable at the historical commit.

Stage 1: four original migrations 119–122 and schema-only tests on the disposable PostgreSQL fixture. The complete migration names do not collide with main; migrations are tracked by full filename. No service, HTTP route, screen, bank connection, payment action, tax calculation, shop enablement or checkout change is registered. Existing shop orders and users are references only.

Still to port/review: server/src/services/shopAgencyLedger.ts, server/src/services/shopAgencyBankReconciliation.ts, server/test/shopAgencyLedger.test.ts, server/test/shopAgencyBank.test.ts, server/src/app.ts, web/src/screens/admin.tsx, web/src/screens/adminAgencyLedger.tsx, e2e/admin-navigation-ux.mjs, scripts/load-mixed-1000.mjs, .github/workflows/load-1000.yml, docs/AGENCY_BANK_RECONCILIATION.md, docs/AGENCY_LEDGER_FINAL_HANDOFF.md, docs/AGENCY_LEDGER_IMPLEMENTATION.md, docs/AGENCY_LEDGER_PHASE2_OPERATIONS.md. No historical API or UI is deployed by this stage.

Before release: verify actual PostgreSQL on fresh and migrated schema; migrate services with current authorization, order snapshot, pre-procurement mandate, append-only activity classification, bank unmatched state, privacy/retention, and correction review. Do not infer a tax base or allocate real funds from an imported CSV. Review accounting/legal rules and validate all required CI on the integrated head. Until then PR stays draft; no main merge or VPS deployment. See #270 and #278 for coordination.

## Stage 2 — pure reconciliation and CSV import validation

Ported historical reconciliation and bank parser as domain modules with six standalone regression tests. Preserve `taxableRevenue=null`, proof gates, stale-review invalidation, chronology warnings, Moscow date boundaries, exact kopecks and unique bank references. No service classes or API connected. Next stage imports the domain functions into the service classes, not a competing ledger. Tests need actual CI; no financial production activation.

## Stage 3 — isolated evidence services

Ported both historical classes to current calendar main 0e552f70db03939d8cb363aa8b90634bf71213c9, reuse the stage 2 domain modules rather than duplicate their logic. Added live administrator checks and row locking on write transactions; direct disposable service test covers private files, identical import, rejected changed metadata and a revoked administrator role. No registered HTTP API or UI, no real payment action. Source snapshots, mandate-at-creation checks, bank activity classification, transactional read consistency, retention policy and original HTTP tests remain outstanding; this is not full production authorization or a release. Exact combined CI required.
