-- Community notification consent is isolated from SOS, orders, payments and
-- system security messages. All promotional/traffic-style alerts remain off.
create table if not exists community_notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  dm_invites boolean not null default true,
  dm_messages boolean not null default false,
  case_replies boolean not null default false,
  quiet_enabled boolean not null default false,
  quiet_start_minute int not null default 1320
    check(quiet_start_minute between 0 and 1439),
  quiet_end_minute int not null default 480
    check(quiet_end_minute between 0 and 1439),
  quiet_timezone text not null default 'Europe/Moscow'
    check(length(quiet_timezone) between 3 and 80),
  updated_at timestamptz not null default now()
);
create table if not exists community_notification_room_mutes (
  user_id uuid not null references users(id) on delete cascade,
  room_id uuid not null references community_rooms(id) on delete cascade,
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,room_id)
);
create table if not exists community_notification_thread_mutes (
  user_id uuid not null references users(id) on delete cascade,
  thread_id uuid not null references community_dm_threads(id) on delete cascade,
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,thread_id)
);

-- Atomic anti-flood: a notification channel can send at most once per scope
-- until the next_allowed_at timestamp, regardless of API replica count.
create table if not exists community_notification_cooldowns (
  user_id uuid not null references users(id) on delete cascade,
  channel text not null check(channel in ('dm_invites','dm_messages','case_replies')),
  scope_id uuid not null,
  next_allowed_at timestamptz not null,
  primary key(user_id,channel,scope_id)
);
