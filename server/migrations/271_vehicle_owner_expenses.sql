-- Voluntary owner-only costs. Not platform invoicing, payouts, or tax ledger.
create table if not exists vehicle_owner_expenses(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  kind text not null check(kind in ('fuel','maintenance','tyres','tolls','insurance','other')),
  amount_kopeks bigint not null check(amount_kopeks between 1 and 100000000000),
  incurred_on date not null,
  note text not null default '' check(length(note)<=500),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_owner_expenses_by_vehicle on vehicle_owner_expenses(owner_id,vehicle_id,incurred_on desc,id);
