-- Warehouse discrepancies must stay visible to dispatch until independently
-- reconciled. These records do not adjust inventory, supplier balances or cash.
-- Older courier runs and existing warehouse checks remain untouched.
create table if not exists shop_warehouse_discrepancies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references shop_courier_runs(id) on delete cascade,
  stop_id uuid references shop_courier_stops(id) on delete set null,
  order_number int not null,
  line_index int not null check(line_index between 0 and 499),
  kind text not null check(kind in
    ('wrong_article','shortage','surplus','damaged','seal_broken','other')),
  expected_article text not null,
  expected_qty int not null check(expected_qty>0),
  observed_article text not null,
  observed_qty int not null check(observed_qty>=0),
  note text not null check(length(trim(note)) between 20 and 1000),
  reported_by uuid references users(id) on delete set null,
  reported_at timestamptz not null default clock_timestamp(),
  status text not null default 'open' check(status in ('open','resolved')),
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  constraint shop_warehouse_discrepancy_resolution check (
    (status='open' and resolved_by is null and resolved_at is null
      and resolution_note is null)
    or (status='resolved' and resolved_at is not null
      and length(trim(coalesce(resolution_note,'')))>=20)
  )
);
create unique index if not exists shop_warehouse_one_open_discrepancy_per_line
  on shop_warehouse_discrepancies(stop_id,line_index) where status='open';
create index if not exists shop_warehouse_discrepancy_time
  on shop_warehouse_discrepancies(run_id,reported_at desc);
