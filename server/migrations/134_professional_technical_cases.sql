-- Technical problem cards are private to verified professional clubs.
-- No order_id, customer identity, phone, VIN, GPS, license plate or address
-- is stored: any order context is copied ONLY as non-identifying make/model/year.
create table if not exists community_technical_cases (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references community_rooms(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  client_nonce uuid not null,
  make text,
  model text,
  model_year int check (model_year between 1985 and 2026),
  subsystem text not null check (length(subsystem) between 2 and 80),
  symptoms text not null check (length(symptoms) between 40 and 2500),
  dtc_codes text[] not null default '{}',
  diagnostic_context text check (diagnostic_context is null or length(diagnostic_context)<=1500),
  origin text not null default 'manual' check (origin in ('manual','order_preview')),
  status text not null default 'open' check (status in ('open','resolved')),
  accepted_reply_id bigint,
  knowledge_proposal_id uuid references community_knowledge(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(author_id,client_nonce),
  constraint technical_case_resolved check (
    (status='open' and resolved_at is null)
    or (status='resolved' and resolved_at is not null))
);
create index if not exists technical_cases_room_recent
  on community_technical_cases(room_id,created_at desc,id);
create index if not exists technical_cases_search
  on community_technical_cases(lower(subsystem),lower(make),created_at desc);
create table if not exists community_technical_case_replies (
  id bigint generated always as identity primary key,
  case_id uuid not null references community_technical_cases(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  client_nonce uuid not null,
  body text not null check(length(body) between 10 and 2000),
  created_at timestamptz not null default now(),
  unique(author_id,client_nonce),
  unique(case_id,id)
);
create index if not exists technical_case_replies_cursor on community_technical_case_replies(case_id,id);
alter table community_technical_cases
  add constraint technical_case_accepted_reply_fk foreign key(id,accepted_reply_id)
  references community_technical_case_replies(case_id,id) deferrable initially immediate;
