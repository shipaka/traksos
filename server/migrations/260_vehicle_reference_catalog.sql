-- Versioned reference data for vehicle make -> model selection (#91/#92).
-- Isolated from existing fleet/insurance/shop columns, UI, and draft PRs.
-- No externally sourced entries are seeded: legal redistribution rights are not assumed.
create table if not exists vehicle_ref_sources (
  source_key text primary key check (source_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  source_name text not null check (length(source_name) between 2 and 150),
  origin_url text not null check (length(origin_url) between 9 and 500),
  license_name text not null check (length(license_name) between 2 and 120),
  license_url text not null check (length(license_url) between 9 and 500),
  rights_evidence text not null check (length(rights_evidence) between 20 and 2000),
  redistribution_approved boolean not null default false,
  state text not null default 'pending'
    check (state in ('pending','approved','revoked')),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  revoked_by uuid references users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_reason text,
  check (state <> 'approved' or (approved_at is not null and approved_by is not null and redistribution_approved)),
  check (state <> 'revoked' or (revoked_at is not null and revoked_by is not null))
);

create table if not exists vehicle_ref_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references vehicle_ref_sources(source_key) on delete restrict,
  revision text not null check (length(revision) between 1 and 100),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'staged' check (state in ('staged','active','retired')),
  brand_count int not null check (brand_count between 1 and 1500),
  model_count int not null check (model_count between 1 and 12000),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_by uuid references users(id) on delete restrict,
  published_at timestamptz,
  retired_at timestamptz,
  unique (source_key, revision),
  check (state <> 'active' or (published_at is not null and published_by is not null))
);
create unique index if not exists vehicle_ref_single_active_source
  on vehicle_ref_snapshots(source_key) where state='active';
create index if not exists vehicle_ref_snapshots_source_state
  on vehicle_ref_snapshots(source_key, state, created_at desc);

create table if not exists vehicle_ref_brands (
  snapshot_id uuid not null references vehicle_ref_snapshots(id) on delete restrict,
  category text not null check (category in ('truck','trailer','bus','van','passenger')),
  brand_key text not null check (brand_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  display_name text not null check (length(display_name) between 1 and 120),
  aliases text[] not null default '{}'::text[],
  primary key (snapshot_id, category, brand_key)
);
create index if not exists vehicle_ref_brands_category
  on vehicle_ref_brands(category, brand_key);

create table if not exists vehicle_ref_models (
  snapshot_id uuid not null,
  category text not null,
  brand_key text not null,
  model_key text not null check (model_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  display_name text not null check (length(display_name) between 1 and 120),
  aliases text[] not null default '{}'::text[],
  year_from int check (year_from between 1900 and 2100),
  year_to int check (year_to between 1900 and 2100),
  primary key (snapshot_id, category, brand_key, model_key),
  foreign key (snapshot_id, category, brand_key)
    references vehicle_ref_brands(snapshot_id, category, brand_key) on delete restrict,
  check (year_from is null or year_to is null or year_from <= year_to)
);
create index if not exists vehicle_ref_models_brand
  on vehicle_ref_models(category, brand_key, model_key);

-- Append-only record of source approvals, revocations, snapshot publication and rollback.
-- The normal audit_log additionally records who accessed each report/selection.
create table if not exists vehicle_ref_registry_events (
  id bigserial primary key,
  source_key text not null references vehicle_ref_sources(source_key) on delete restrict,
  snapshot_id uuid references vehicle_ref_snapshots(id) on delete restrict,
  event_kind text not null check (event_kind in
    ('source_registered','source_approved','source_revoked','revision_staged','revision_published','revision_restored')),
  reason text not null check (length(reason) between 10 and 2000),
  actor_id uuid not null references users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index if not exists vehicle_ref_registry_history
  on vehicle_ref_registry_events(source_key, recorded_at, id);

create or replace function vehicle_ref_reject_history_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'vehicle reference history is immutable: publish a new snapshot';
end $$;
drop trigger if exists vehicle_ref_brands_immutable on vehicle_ref_brands;
create trigger vehicle_ref_brands_immutable
  before update or delete on vehicle_ref_brands
  for each row execute function vehicle_ref_reject_history_mutation();
drop trigger if exists vehicle_ref_models_immutable on vehicle_ref_models;
create trigger vehicle_ref_models_immutable
  before update or delete on vehicle_ref_models
  for each row execute function vehicle_ref_reject_history_mutation();
drop trigger if exists vehicle_ref_registry_events_immutable on vehicle_ref_registry_events;
create trigger vehicle_ref_registry_events_immutable
  before update or delete on vehicle_ref_registry_events
  for each row execute function vehicle_ref_reject_history_mutation();
