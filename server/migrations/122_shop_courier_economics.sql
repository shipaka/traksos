-- Courier economics must be explicitly forecast and approved before route acceptance.
-- The separate 5% platform fee is NOT booked as merchandise or courier profit
-- until its legal/checkout collection path is implemented.
create table if not exists shop_courier_run_budgets (
 run_id uuid primary key references shop_courier_runs(id) on delete cascade,
 courier_pay_kopecks bigint not null check (courier_pay_kopecks >= 0),
 fuel_kopecks bigint not null check (fuel_kopecks >= 0),
 packing_kopecks bigint not null check (packing_kopecks >= 0),
 acquiring_kopecks bigint not null check (acquiring_kopecks >= 0),
 taxes_kopecks bigint not null check (taxes_kopecks >= 0),
 other_kopecks bigint not null check (other_kopecks >= 0),
 estimate_note text not null check (char_length(estimate_note) between 10 and 1000),
 reviewed_by uuid not null references users(id),
 reviewed_at timestamptz not null default now()
);
alter table shop_courier_runs
  add column if not exists dispatch_approved_at timestamptz,
  add column if not exists dispatch_approved_by uuid references users(id),
  add column if not exists dispatch_exception_reason text;
