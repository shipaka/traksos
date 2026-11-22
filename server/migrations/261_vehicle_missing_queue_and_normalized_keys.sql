-- Normalized vehicle selections and missing-make/model moderation, without
-- destructive rewrite of the existing garage or the insurer's historic records.
alter table vehicles add column if not exists catalog_category text
  check (catalog_category in ('passenger','truck','van','bus','trailer'));
alter table vehicles add column if not exists catalog_brand_key text;
alter table vehicles add column if not exists catalog_model_key text;
alter table vehicles add column if not exists catalog_source_version text;

-- A proposed item never becomes a catalog make/model until independently
-- verified and released in a new licensed catalog snapshot.
create table if not exists vehicle_catalog_missing_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references users(id) on delete cascade,
  category text not null check (category in ('passenger','truck','van','bus','trailer')),
  purpose text not null check (purpose in ('garage','master','tow','service','insurance','parts','admin')),
  proposed_make text not null check (length(btrim(proposed_make)) between 2 and 100),
  proposed_model text not null check (length(btrim(proposed_model)) between 2 and 120),
  proposed_year int check (proposed_year between 1900 and 2100),
  note text not null default '' check (length(note) <= 1200),
  status text not null default 'new' check (status in ('new','reviewing','accepted','rejected')),
  moderation_note text,
  moderated_by uuid references users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('new','reviewing') or (moderated_by is not null and moderated_at is not null))
);
create unique index if not exists vehicle_missing_no_duplicate_pending
  on vehicle_catalog_missing_requests(requested_by,category,lower(btrim(proposed_make)),lower(btrim(proposed_model)))
  where status in ('new','reviewing');
create index if not exists vehicle_missing_moderation_queue
  on vehicle_catalog_missing_requests(status,created_at,id);
