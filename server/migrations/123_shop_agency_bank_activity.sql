-- Deliberate manual classification; original CSV and bank rows stay immutable.
-- No row receives a tax category or becomes a confirmed payment automatically.
create table if not exists shop_agency_bank_classifications (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references shop_agency_bank_rows(id) on delete restrict,
  activity text not null check (activity in ('unmatched','traksos_service','traksos_shop','ip_primary','other')),
  note text not null check (length(btrim(note)) between 8 and 1000),
  request_key text not null check (length(btrim(request_key)) between 8 and 120),
  revision bigint not null check (revision>0),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(row_id,revision),
  unique(row_id,request_key)
);
drop trigger if exists shop_agency_bank_classifications_immutable on shop_agency_bank_classifications;
create trigger shop_agency_bank_classifications_immutable before update or delete on shop_agency_bank_classifications
for each row execute function shop_agency_reject_mutation();
