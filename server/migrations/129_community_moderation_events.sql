-- New public messages and changes to publication state are delivered independently of message-id cursors.
-- No message body / phone / exact GPS is stored in these event ledgers.
-- Moderators serialize changes per room/thread by locking parent rows.
create table if not exists community_room_moderation_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references community_rooms(id) on delete cascade,
  message_id bigint not null references community_messages(id) on delete cascade,
  previous_state text not null check (previous_state in ('created','published','pending','hidden')),
  moderation_state text not null check (moderation_state in ('published','hidden')),
  changed_at timestamptz not null default now()
);
create index if not exists community_room_moderation_events_cursor
  on community_room_moderation_events(room_id,id);

create table if not exists community_dm_moderation_events (
  id bigint generated always as identity primary key,
  thread_id uuid not null references community_dm_threads(id) on delete cascade,
  message_id bigint not null references community_dm_messages(id) on delete cascade,
  previous_state text not null check (previous_state in ('created','published','pending','hidden')),
  moderation_state text not null check (moderation_state in ('published','hidden')),
  changed_at timestamptz not null default now()
);
create index if not exists community_dm_moderation_events_cursor
  on community_dm_moderation_events(thread_id,id);
