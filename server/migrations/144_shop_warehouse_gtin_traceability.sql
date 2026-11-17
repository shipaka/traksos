-- Optional strictly reviewed GS1 identifiers on newly planned, packing-required courier routes.
-- Existing routes remain unchanged: this is NOT a verified supplier or OEM product registry.
alter table shop_courier_runs
  add column if not exists traceability_required boolean not null default false;
alter table shop_courier_runs
  add constraint shop_courier_trace_requires_packing
  check(not traceability_required or packing_required);

create table if not exists shop_warehouse_line_traces (
  stop_id uuid not null references shop_courier_stops(id) on delete cascade,
  line_index int not null check(line_index between 0 and 499),
  article_snapshot text not null check(length(trim(article_snapshot)) between 2 and 100),
  qty_snapshot int not null check(qty_snapshot between 1 and 10000),
  gtin text not null check(gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),
  lot text check(lot is null or length(trim(lot)) between 3 and 80),
  serials text[] not null default '{}'::text[],
  input_method text not null check(input_method in ('manual','keyboard_wedge')),
  manual_reason text check(manual_reason is null or length(trim(manual_reason)) between 15 and 500),
  recorded_by uuid references users(id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(stop_id,line_index),
  constraint shop_trace_has_lot_or_serial check(lot is not null or cardinality(serials)>0),
  constraint shop_trace_serial_count check(cardinality(serials)=0 or cardinality(serials)=qty_snapshot),
  constraint shop_trace_serial_limit check(cardinality(serials)<=100)
);
create index if not exists shop_trace_gtin_lot
  on shop_warehouse_line_traces(gtin,lot) where lot is not null;
