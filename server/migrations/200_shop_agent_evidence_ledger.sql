-- TrackSOS: isolated evidence-first agency shop ledger (draft; no live routing).
-- Distinct from partner_finance_entries, payments and shop_orders. Never
-- infer tax base from supplier/customer price difference.
--
-- Do not expose these tables to a public/shop API. Primary documents are
-- referenced by opaque protected storage IDs + SHA-256; bytes live elsewhere.

create table if not exists shop_agent_ledger_lines (
  id uuid primary key default gen_random_uuid(),
  shop_order_id uuid not null references shop_orders(id) on delete restrict,
  line_key text not null check (length(line_key) between 1 and 120),
  client_org_ref text not null check (length(client_org_ref) between 1 and 160),
  supplier_ref text not null check (length(supplier_ref) between 1 and 160),
  operation_kind text not null check (operation_kind in
    ('client_purchase_agent', 'supplier_sales_agent', 'own_inventory_sale')),
  agreed_customer_total bigint not null check (agreed_customer_total >= 0),
  currency char(3) not null default 'RUB' check (currency='RUB'),
  offer_version text not null,
  offer_hash char(64) not null check (offer_hash ~ '^[0-9a-fA-F]{64}$'),
  fee_schedule_version text not null,
  mandate_ref text,
  mandate_accepted_at timestamptz,
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  unique(shop_order_id, line_key),
  check (operation_kind <> 'client_purchase_agent' or
    (mandate_ref is not null and length(mandate_ref) > 0 and mandate_accepted_at is not null))
);
create index if not exists shop_agent_ledger_lines_client_idx
  on shop_agent_ledger_lines(client_org_ref, recorded_at desc);

create table if not exists shop_agent_ledger_events (
  id uuid primary key default gen_random_uuid(),
  event_seq bigint generated always as identity unique, -- ingestion order
  line_id uuid not null references shop_agent_ledger_lines(id) on delete restrict,
  event_key text not null unique check (length(event_key) between 1 and 160),
  event_kind text not null check (event_kind in (
    'mandate_evidence', 'supplier_order', 'procurement_document', 'sale_document',
    'handover', 'agent_report', 'customer_receipt', 'supplier_payment',
    'customer_refund', 'supplier_refund', 'reimbursement_agreed',
    'procurement_fee_agreed', 'platform_fee_agreed', 'recognized_revenue',
    'input_vat', 'output_vat', 'accountant_approval'
  )),
  amount_kopecks bigint not null,
  occurred_at timestamptz not null,
  source_kind text not null check (source_kind in (
    'internal_record', 'supplier_api_quote', 'manual_unverified',
    'primary_document_verified', 'payment_confirmed', 'accountant_attested'
  )),
  source_ref text not null,
  evidence_hash char(64) check (evidence_hash ~ '^[0-9a-fA-F]{64}$'),
  compensates_event_key text references shop_agent_ledger_events(event_key),
  correction_reason text,
  payload_hash char(64) not null,
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  check (
    (event_kind in ('mandate_evidence', 'supplier_order', 'handover', 'agent_report', 'accountant_approval')
      and amount_kopecks=0)
    or
    (event_kind not in ('mandate_evidence', 'supplier_order', 'handover', 'agent_report', 'accountant_approval')
      and amount_kopecks<>0)
  ),
  check (
    (amount_kopecks<0 and compensates_event_key is not null and length(coalesce(correction_reason,''))>=8)
    or
    (amount_kopecks>=0 and compensates_event_key is null)
  ),
  check (event_kind <> 'accountant_approval' or
    (source_kind='accountant_attested' and evidence_hash is not null))
);
create index if not exists shop_agent_ledger_event_time_idx
  on shop_agent_ledger_events(occurred_at, line_id);
create index if not exists shop_agent_ledger_line_time_idx
  on shop_agent_ledger_events(line_id, occurred_at, id);
create index if not exists shop_agent_ledger_reversals_idx
  on shop_agent_ledger_events(compensates_event_key)
  where compensates_event_key is not null;

create table if not exists shop_agent_ledger_exports (
  id uuid primary key default gen_random_uuid(),
  period_from_utc timestamptz not null,
  period_to_utc timestamptz not null,
  snapshot jsonb not null,
  sha256 char(64) not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (period_to_utc > period_from_utc)
);
create index if not exists shop_agent_ledger_exports_idx
  on shop_agent_ledger_exports(created_at desc);

-- A correction, updated fee schedule, refunded payment, or reclassification
-- requires NEW entries, never UPDATE/DELETE. Original objects stay auditable.
create or replace function shop_agent_ledger_immutable_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'Shop agent ledger is append-only; add an audited correction';
end $$;

create trigger shop_agent_lines_immutable
before update or delete on shop_agent_ledger_lines
for each row execute function shop_agent_ledger_immutable_guard();
create trigger shop_agent_events_immutable
before update or delete on shop_agent_ledger_events
for each row execute function shop_agent_ledger_immutable_guard();
create trigger shop_agent_exports_immutable
before update or delete on shop_agent_ledger_exports
for each row execute function shop_agent_ledger_immutable_guard();
