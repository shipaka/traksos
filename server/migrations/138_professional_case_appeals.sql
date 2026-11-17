-- One appeal per removed piece of professional advice and its author.
-- The original moderation decision remains immutable for audit.
-- Appeals are reviewed by a DIFFERENT staff member.
create table if not exists community_technical_case_appeals (
  id bigint generated always as identity primary key,
  report_id bigint not null references community_technical_case_reports(id) on delete cascade,
  case_id uuid not null references community_technical_cases(id) on delete cascade,
  appellant_id uuid not null references users(id) on delete cascade,
  grounds text not null check(length(grounds) between 30 and 1500),
  status text not null default 'pending' check(status in ('pending','upheld','overturned')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check(review_note is null or length(review_note) between 15 and 1500),
  unique(report_id,appellant_id),
  constraint technical_appeal_resolution check(
    (status='pending' and reviewed_at is null and reviewed_by is null)
    or (status<>'pending' and reviewed_at is not null))
);
create index if not exists community_technical_appeals_queue
  on community_technical_case_appeals(created_at,id) where status='pending';
create index if not exists community_technical_appeals_author
  on community_technical_case_appeals(appellant_id,created_at desc);
