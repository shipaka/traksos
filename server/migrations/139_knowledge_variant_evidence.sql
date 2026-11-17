-- Evidence of vehicle variant applicability is separate from article authorship.
-- No VIN, registration plate, customer or GPS is stored. A matching entry is
-- NOT an OEM VIN verification, and absence of entries is NOT incompatibility.
create table if not exists community_knowledge_applicability (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references community_knowledge(id) on delete cascade,
  make text not null check(length(trim(make)) between 2 and 80),
  model text not null check(length(trim(model)) between 2 and 80),
  year_from int not null check(year_from between 1985 and 2026),
  year_to int not null check(year_to between 1985 and 2026),
  engine_code text check(engine_code is null or length(trim(engine_code)) between 2 and 60),
  ecu_variant text check(ecu_variant is null or length(trim(ecu_variant)) between 2 and 60),
  evidence_url text not null check(evidence_url ~ '^https://'),
  source_revision text not null check(length(trim(source_revision)) between 2 and 80),
  verification_note text not null check(length(trim(verification_note)) between 30 and 1500),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  status text not null default 'active' check(status in ('active','withdrawn')),
  constraint vehicle_applicability_year_order check(year_from<=year_to)
);
create index if not exists knowledge_applicability_article
  on community_knowledge_applicability(knowledge_id,status,year_from,year_to);
create index if not exists knowledge_applicability_vehicle
  on community_knowledge_applicability(lower(make),lower(model),year_from,year_to)
  where status='active';
