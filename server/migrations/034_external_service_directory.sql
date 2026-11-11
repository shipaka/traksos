-- Informational listings managed by TrakSOS, not contractual partners.
create table if not exists external_service_directory (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 address text not null,
 lat double precision,
 lng double precision,
 hours text,
 public_notes text,
 private_phone text,
 outreach_status text not null default 'not_contacted' check (outreach_status in ('not_contacted','contacted','interested','declined')),
 visibility text not null default 'draft' check (visibility in ('draft','published','hidden')),
 created_by uuid references users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists external_service_directory_visible on external_service_directory(visibility);
