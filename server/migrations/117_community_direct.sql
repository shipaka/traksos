-- Driver-only consensual direct messaging. Never join public rooms with DMs.
-- All identifiers are account-linked on the server but only nicknames are exposed.
create table if not exists community_dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references users(id) on delete cascade,
  user_b uuid not null references users(id) on delete cascade,
  initiated_by uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a::text < user_b::text),
  check (initiated_by = user_a or initiated_by = user_b),
  unique(user_a,user_b)
);
create index if not exists community_dm_threads_a on community_dm_threads(user_a,updated_at desc);
create index if not exists community_dm_threads_b on community_dm_threads(user_b,updated_at desc);
create index if not exists community_dm_threads_invite_rate on community_dm_threads(initiated_by,created_at desc);

create table if not exists community_user_blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker_id <> blocked_id),
  primary key(blocker_id,blocked_id)
);
create index if not exists community_user_blocks_blocked on community_user_blocks(blocked_id);

create table if not exists community_dm_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references community_dm_threads(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  client_nonce uuid not null,
  moderation_state text not null default 'published' check (moderation_state in ('published','pending','hidden')),
  created_at timestamptz not null default now(),
  unique(sender_id,client_nonce)
);
create index if not exists community_dm_messages_thread_cursor on community_dm_messages(thread_id,id);
create index if not exists community_dm_messages_sender_rate on community_dm_messages(sender_id,created_at desc);

create table if not exists community_dm_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references community_dm_messages(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 240),
  status text not null default 'open' check (status in ('open','reviewed')),
  created_at timestamptz not null default now(),
  unique(message_id,reporter_id)
);
create index if not exists community_dm_reports_reporter on community_dm_reports(reporter_id);

-- Driver route subscriptions are explicit; no location sensors or exact GPS.
-- Regional and route rooms use existing community_rooms + community_memberships.
