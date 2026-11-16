-- Optional warehouse physical line verification before dispatch and pickup.
-- Existing routes default to legacy manual collection, never silently blocked.
-- Admin explicitly enables this on a NEW run; no effect on existing orders.
alter table shop_courier_runs
  add column if not exists packing_required boolean not null default false;

create table if not exists shop_warehouse_line_checks (
  stop_id uuid not null references shop_courier_stops(id) on delete cascade,
  line_index int not null check(line_index>=0 and line_index<500),
  checked_article text not null,
  checked_qty int not null check(checked_qty>0),
  method text not null check(method in ('scanner','manual')),
  manual_reason text,
  checked_by uuid references users(id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key(stop_id,line_index),
  constraint manual_packing_reason check(
    method='scanner' or length(trim(coalesce(manual_reason,'')))>=15)
);
create index if not exists warehouse_checks_author on shop_warehouse_line_checks(checked_by,checked_at);
