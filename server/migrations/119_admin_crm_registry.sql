-- CRM metadata belongs to user identity; business facts remain in the source tables.
-- No copy of contacts, passports, payment credentials, or external ad profiles.
create table if not exists admin_crm_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  region text,
  city text,
  tags text[] not null default '{}',
  note text not null default '',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint admin_crm_region_length check (region is null or char_length(region) <= 80),
  constraint admin_crm_city_length check (city is null or char_length(city) <= 120),
  constraint admin_crm_note_length check (char_length(note) <= 2000),
  constraint admin_crm_tags_length check (cardinality(tags) <= 12)
);
create index if not exists admin_crm_region_idx on admin_crm_profiles(lower(region));
create index if not exists admin_crm_tags_idx on admin_crm_profiles using gin(tags);
comment on table admin_crm_profiles is
  'Admin-only annotations; operational activity, identity and legal cards stay in existing source tables.';
