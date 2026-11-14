-- Confirmed partner earnings by service direction; no implied commission from application status.
create table if not exists partner_finance_entries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references users(id),
  request_id uuid not null references vehicle_service_requests(id),
  kind text not null check (kind in ('insurance','inspection')),
  amount_kopecks bigint not null check (amount_kopecks > 0),
  entry_type text not null check (entry_type in ('accrual','reversal','payout')),
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists partner_finance_partner_idx
  on partner_finance_entries(partner_id,created_at desc);
create index if not exists partner_finance_request_idx
  on partner_finance_entries(request_id);
-- Financial history is append-only. Corrections require a compensating entry.
create or replace function partner_finance_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Partner finance entries are immutable; add a compensating entry';
end $$;
drop trigger if exists partner_finance_immutable_guard on partner_finance_entries;
create trigger partner_finance_immutable_guard before update or delete on partner_finance_entries
for each row execute function partner_finance_immutable();
