-- Specialist forums must support reports about unsafe technical advice.
-- A removed accepted answer is detached; unsafe shared knowledge is withdrawn
-- for human technical re-review, never silently republished.
alter table community_technical_cases
  add column if not exists moderation_state text not null default 'published'
  check (moderation_state in ('published','hidden'));
alter table community_technical_case_replies
  add column if not exists moderation_state text not null default 'published'
  check (moderation_state in ('published','hidden'));
create index if not exists technical_cases_visible
  on community_technical_cases(room_id,created_at desc,id)
  where moderation_state='published';
create index if not exists technical_case_replies_visible
  on community_technical_case_replies(case_id,id)
  where moderation_state='published';

create table if not exists community_technical_case_reports (
  id bigint generated always as identity primary key,
  case_id uuid not null references community_technical_cases(id) on delete cascade,
  reply_id bigint,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check(length(reason) between 10 and 500),
  status text not null default 'open' check(status in ('open','reviewed')),
  decision text check(decision in ('dismiss','hide','restore')),
  reviewed_by uuid references users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key (case_id,reply_id) references community_technical_case_replies(case_id,id) on delete cascade
);
create unique index if not exists technical_case_one_report_per_author
  on community_technical_case_reports(case_id,coalesce(reply_id,0::bigint),reporter_id);
create index if not exists technical_case_reports_open
  on community_technical_case_reports(created_at,id) where status='open';
