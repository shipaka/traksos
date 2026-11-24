-- PR #274: chat deletion invalidates in-flight answers without restoring
-- the request quota. Store only account identity, generation and timestamps,
-- never message text or external provider responses in these tables.
create table trakbot_history_generation (
  user_id uuid primary key references users(id) on delete cascade,
  generation bigint not null default 0
);

create table trakbot_request_attempts (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp()
);
create index trakbot_request_attempts_user_time
  on trakbot_request_attempts(user_id, requested_at);

-- Preserve the existing rolling limit across the upgrade.
insert into trakbot_request_attempts(user_id, requested_at)
select user_id, created_at from trakbot_messages
where role='user' and created_at > now() - interval '1 day';
