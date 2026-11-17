-- Voluntary access to Driver Air for a fleet owner who also drives.
-- No second auth role or new login; disabled by default.
create table if not exists community_driver_optins (
  user_id uuid primary key references users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists community_driver_optins_enabled_idx
  on community_driver_optins(user_id) where enabled=true;
