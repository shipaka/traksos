-- Agent purchase evidence ledger: isolated, private, append-only, not linked to checkout payments.
-- Migration 160 stays after the draft community/shop migrations 116–151.
-- No supplier API assumptions or automatic tax declarations.
create table if not exists shop_agent_evidence_lines (
  id uuid primary key default gen_random_uuid(),
  external_line_key text not null unique check (length(external_line_key) between 3 and 120),
  shop_order_id uuid references shop_orders(id) on delete restrict,
  customer_id uuid references users(id) on delete restrict,
  customer_name text not null check (length(customer_name) between 1 and 200),
  customer_inn text,
  operation_kind text not null check (operation_kind in
    ('client_purchase_agent','supplier_sales_agent','own_inventory_sale')),
  supplier_key text not null check (length(supplier_key) between 2 and 100),
  article text not null check (length(article) between 1 and 160),
  quantity_ordered integer not null check (quantity_ordered between 1 and 100000),
  agreed_customer_total_kopecks bigint not null check (agreed_customer_total_kopecks >= 0),
  agent_fee_agreed_kopecks bigint not null check (agent_fee_agreed_kopecks >= 0),
  platform_fee_agreed_kopecks bigint not null check (platform_fee_agreed_kopecks >= 0),
  mandate_reference text,
  mandate_accepted_at timestamptz,
  supplier_contract_reference text,
  offer_version text,
  offer_hash text,
  fee_schedule_version text not null,
  currency char(3) not null default 'RUB' check (currency = 'RUB'),
  snapshot_hash char(64) not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (agent_fee_agreed_kopecks + platform_fee_agreed_kopecks <= agreed_customer_total_kopecks)
);
create index if not exists shop_agent_evidence_customer
  on shop_agent_evidence_lines(customer_inn, created_at desc);
create index if not exists shop_agent_evidence_orders
  on shop_agent_evidence_lines(shop_order_id);

create table if not exists shop_agent_evidence_events (
  id bigserial primary key,
  external_key text not null unique check (length(external_key) between 3 and 160),
  line_id uuid not null references shop_agent_evidence_lines(id) on delete restrict,
  kind text not null check (kind in (
    'mandate_accepted','supplier_contract_verified','supplier_quote','supplier_document',
    'customer_receipt','customer_refund','supplier_payment','supplier_refund',
    'handover','agent_report','output_vat_assessed','accountant_approval'
  )),
  component text check (component is null or component in
    ('reimbursement','agent_fee','platform_fee','own_sale')),
  amount_kopecks bigint not null default 0 check (amount_kopecks >= 0),
  vat_kopecks bigint not null default 0 check (vat_kopecks >= 0 and vat_kopecks <= amount_kopecks),
  quantity integer not null default 0 check (quantity >= 0),
  source text not null check (source in ('manual_unverified','accountant_verified','system')),
  reference text,
  document_hash text,
  document_total_kopecks bigint check (document_total_kopecks >= 0),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  payload_hash char(64) not null,
  check (
    (kind in ('customer_receipt','customer_refund') and component is not null) or
    (kind not in ('customer_receipt','customer_refund') and component is null)
  ),
  check (
    kind <> 'supplier_document' or
    (document_hash is not null and reference is not null and document_total_kopecks is not null and quantity > 0)
  ),
  check (kind = 'supplier_document' or (document_hash is null and document_total_kopecks is null))
);
create index if not exists shop_agent_events_line_time
  on shop_agent_evidence_events(line_id, occurred_at, id);
create index if not exists shop_agent_events_period
  on shop_agent_evidence_events(occurred_at, line_id);
create index if not exists shop_agent_events_supplier_doc
  on shop_agent_evidence_events(document_hash) where document_hash is not null;

create table if not exists shop_agent_evidence_exports (
  id uuid primary key default gen_random_uuid(),
  from_utc timestamptz not null,
  to_utc timestamptz not null check (to_utc > from_utc),
  filter_inn text,
  digest_sha256 char(64) not null,
  report_json jsonb not null,
  row_count integer not null check (row_count >= 0),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Corrections and returns are recorded as NEW events. There is no UPDATE/DELETE API.
create or replace function shop_agent_evidence_reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'shop_agent_evidence is append-only: create correction event';
end $$;
drop trigger if exists shop_agent_evidence_lines_immutable on shop_agent_evidence_lines;
create trigger shop_agent_evidence_lines_immutable
  before update or delete on shop_agent_evidence_lines
  for each row execute function shop_agent_evidence_reject_mutation();
drop trigger if exists shop_agent_evidence_events_immutable on shop_agent_evidence_events;
create trigger shop_agent_evidence_events_immutable
  before update or delete on shop_agent_evidence_events
  for each row execute function shop_agent_evidence_reject_mutation();
drop trigger if exists shop_agent_evidence_exports_immutable on shop_agent_evidence_exports;
create trigger shop_agent_evidence_exports_immutable
  before update or delete on shop_agent_evidence_exports
  for each row execute function shop_agent_evidence_reject_mutation();
