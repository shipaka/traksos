-- Manual supplier receipt evidence only. This is NOT an Autokontinent
-- integration, stock movement, supplier invoice or payment confirmation.
-- Multiple deliveries can cover a single order, but approval never exceeds
-- ordered quantities. Every accepted line is audited and immutable.
create table if not exists shop_supplier_receipts (
  id uuid primary key default gen_random_uuid(),
  shop_order_id uuid not null references shop_orders(id) on delete restrict,
  supplier text not null default 'Автоконтинент',
  document_ref text not null check(length(trim(document_ref)) between 3 and 120),
  document_date date not null,
  evidence_note text not null check(length(trim(evidence_note)) between 20 and 1000),
  status text not null default 'draft'
    check(status in ('draft','accepted','void')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references users(id) on delete set null,
  accepted_at timestamptz,
  void_by uuid references users(id) on delete set null,
  void_at timestamptz,
  void_reason text,
  unique(shop_order_id,document_ref),
  constraint supplier_receipt_state check(
    (status='draft' and accepted_at is null and void_at is null)
    or (status='accepted' and accepted_at is not null and void_at is null)
    or (status='void' and void_at is not null
        and length(trim(coalesce(void_reason,'')))>=20))
);
create table if not exists shop_supplier_receipt_lines (
  receipt_id uuid not null references shop_supplier_receipts(id) on delete cascade,
  line_index int not null check(line_index between 0 and 499),
  product_id uuid not null references shop_products(id),
  expected_article text not null,
  expected_qty int not null check(expected_qty between 1 and 10000),
  observed_article text not null default '',
  observed_qty int not null default 0 check(observed_qty between 0 and 10000),
  condition text not null default 'not_checked' check(condition in
    ('not_checked','intact','not_supplied','packaging_damaged','damaged','missing')),
  inspection_note text,
  inspected_by uuid references users(id) on delete set null,
  inspected_at timestamptz,
  primary key(receipt_id,line_index)
);
create index if not exists shop_supplier_receipts_order
  on shop_supplier_receipts(shop_order_id,status,created_at desc);
alter table shop_courier_runs
  add column if not exists supplier_receipt_required boolean not null default false;
alter table shop_courier_runs
  add constraint courier_receipt_requires_packing
  check(not supplier_receipt_required or packing_required);
