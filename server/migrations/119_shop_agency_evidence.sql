-- Isolated, non-posting evidence ledger for agency shop purchases.
-- Deliberately does NOT alter shop checkout, payments, tax returns or production shop enablement.
create table if not exists shop_agency_cases (
  id uuid primary key default gen_random_uuid(),
  shop_order_id uuid not null references shop_orders(id) on delete restrict,
  line_index int not null check (line_index >= 0),
  client_id uuid not null references users(id) on delete restrict,
  client_name text not null,
  client_inn text,
  operation_kind text not null check (operation_kind in ('client_purchase_agent','supplier_sales_agent','own_inventory_sale')),
  supplier_name text not null,
  article text not null,
  quantity int not null check (quantity > 0),
  mandate_ref text,
  mandate_accepted_at timestamptz,
  offer_version text,
  fee_schedule_version text,
  agreed_customer_total bigint not null check (agreed_customer_total >= 0),
  expected_reimbursement bigint not null check (expected_reimbursement >= 0),
  procurement_fee bigint not null check (procurement_fee >= 0),
  platform_fee bigint not null check (platform_fee >= 0),
  evidence_version bigint not null default 0,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(shop_order_id, line_index),
  check ((operation_kind = 'own_inventory_sale' and procurement_fee = 0 and platform_fee = 0 and expected_reimbursement = 0)
    or (operation_kind <> 'own_inventory_sale' and
      agreed_customer_total = expected_reimbursement + procurement_fee + platform_fee))
);
create index if not exists shop_agency_cases_client on shop_agency_cases(client_id, created_at);
create index if not exists shop_agency_cases_order on shop_agency_cases(shop_order_id);

-- Original supplier/mandate files remain private, identifiable by content hash.
-- A document can be allocated across many cases (e.g. a consolidated supplier UPD).
create table if not exists shop_agency_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purchase','mandate','handover','agent_report','payment_proof')),
  supplier_name text not null,
  reference text not null,
  issued_at timestamptz not null,
  amount bigint not null check (amount >= 0),
  vat_amount bigint not null default 0 check (vat_amount >= 0 and vat_amount <= amount),
  quantity int not null default 0 check (quantity >= 0),
  mime text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  file_data bytea not null,
  sha256 text not null unique check (length(sha256)=64),
  source text not null default 'manual_unverified' check (source in ('manual_unverified','manually_checked')),
  review_note text,
  verified_by uuid references users(id) on delete restrict,
  verified_at timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((kind = 'purchase') or (amount = 0 and quantity = 0 and vat_amount = 0))
);
create index if not exists shop_agency_documents_supplier on shop_agency_documents(supplier_name, issued_at);

create table if not exists shop_agency_allocations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references shop_agency_documents(id) on delete restrict,
  case_id uuid not null references shop_agency_cases(id) on delete restrict,
  source_line_key text not null,
  quantity int not null check (quantity >= 0),
  amount bigint not null check (amount >= 0),
  vat_amount bigint not null check (vat_amount >= 0 and vat_amount <= amount),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(document_id, source_line_key),
  unique(document_id, case_id, source_line_key)
);
create index if not exists shop_agency_allocations_case on shop_agency_allocations(case_id);

-- Append-only: reversals are new events, never UPDATE/DELETE original cash evidence.
create table if not exists shop_agency_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references shop_agency_cases(id) on delete restrict,
  idempotency_key text not null,
  kind text not null check (kind in ('customer_receipt','customer_receipt_reversal',
    'supplier_payment','supplier_payment_reversal','customer_refund','supplier_refund',
    'handover','agent_report')),
  amount bigint not null check (amount >= 0),
  source_ref text not null,
  occurred_at timestamptz not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(case_id, idempotency_key),
  check ((kind in ('handover','agent_report') and amount = 0) or
    (kind not in ('handover','agent_report') and amount > 0))
);
create index if not exists shop_agency_events_case_time on shop_agency_events(case_id, occurred_at);

-- Recorded approval becomes stale automatically when evidence_version changes.
create table if not exists shop_agency_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references shop_agency_cases(id) on delete restrict,
  evidence_version bigint not null,
  kind text not null check (kind in ('verified','accountant_approved')),
  note text not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(case_id, evidence_version, kind)
);
