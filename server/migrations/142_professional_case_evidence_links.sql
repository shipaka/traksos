-- Curated external technical source links for verified professional cases.
-- NO uploads, copied OEM PDFs, embeds or remote fetching. Legal and technical
-- review are independent and required before members can open a submitted link.
create table if not exists community_case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references community_technical_cases(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  client_nonce uuid not null,
  title text not null check(length(trim(title)) between 8 and 180),
  source_url text not null check(length(source_url) between 12 and 1200
    and left(source_url,8)='https://'),
  document_revision text not null check(length(trim(document_revision)) between 2 and 120),
  media_kind text not null check(media_kind in ('diagram','manual','video_link')),
  rights_note text not null check(length(trim(rights_note)) between 30 and 1000),
  applicability_note text not null check(length(trim(applicability_note)) between 30 and 1500),
  rights_review text not null default 'pending'
    check(rights_review in ('pending','approved','rejected')),
  technical_review text not null default 'pending'
    check(technical_review in ('pending','approved','rejected')),
  rights_reviewer uuid references users(id) on delete set null,
  technical_reviewer uuid references users(id) on delete set null,
  rights_review_note text,
  technical_review_note text,
  status text not null default 'active' check(status in ('active','withdrawn')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(author_id,client_nonce)
);
create index if not exists case_evidence_published
  on community_case_evidence(case_id,created_at,id)
  where status='active' and rights_review='approved' and technical_review='approved';
create index if not exists case_evidence_review_queue
  on community_case_evidence(created_at,id)
  where status='active' and (rights_review='pending' or technical_review='pending');
