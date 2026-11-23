-- Owner-approved public partner map (2026-11-23).
-- NEVER publish private live performer GPS. Stationary workshop visibility is
-- an independent, revocable, opt-in permission, false for ALL existing rows.
alter table service_centers
  add column if not exists public_map_opt_in boolean not null default false;
alter table service_centers
  add column if not exists public_map_opted_at timestamptz;
create index if not exists service_centers_public_map_visible
  on service_centers(id)
  where public_map_opt_in=true and verification='approved' and paused=false;
