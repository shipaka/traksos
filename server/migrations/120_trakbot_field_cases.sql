-- Professional repair cases (separate from open DTC definitions).
-- Submission and approval are distinct; unpublished cases must never enter public bot responses.
create table if not exists technical_repair_cases (
  id bigserial primary key,
  author_id uuid not null references users(id) on delete cascade,
  make text not null,
  model text not null default '',
  production_year integer check(production_year between 1980 and 2100),
  ecu text not null default '',
  code text not null default '',
  symptoms text not null,
  checks_performed text not null,
  verified_fix text not null,
  provenance_note text not null default '',
  review_state text not null default 'pending' check (review_state in ('pending','approved','rejected')),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists technical_cases_by_state on technical_repair_cases(review_state, id desc);
create index if not exists technical_cases_by_code on technical_repair_cases(code) where review_state='approved';
