-- Driver reported road events: deliberately NO exact GPS/route history.
-- Expiry is enforced in every read, independently from cleanup jobs.
create table if not exists community_road_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references community_rooms(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  category text not null check (category in ('traffic','parking','roadworks','weather','question')),
  locality text,
  description text not null check (char_length(description) between 10 and 500),
  moderation_state text not null default 'published' check (moderation_state in ('published','pending','hidden')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at>created_at and expires_at<=created_at + interval '12 hours')
);
create index if not exists community_road_events_active_room on community_road_events(room_id,expires_at desc,created_at desc) where moderation_state='published';
create index if not exists community_road_events_author_rate on community_road_events(author_id,created_at desc);

create table if not exists community_road_event_reports (
  id bigint generated always as identity primary key,
  event_id uuid not null references community_road_events(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 240),
  status text not null default 'open' check (status in ('open','reviewed')),
  created_at timestamptz not null default now(),
  unique(event_id,reporter_id)
);
create index if not exists community_road_event_reports_reporter on community_road_event_reports(reporter_id);
