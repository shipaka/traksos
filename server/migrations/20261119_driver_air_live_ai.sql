-- AI is a visibly marked, non-human author of explicitly requested public posts.
-- Removal of the user's original question cascades to its bot reply.
alter table community_messages alter column sender_id drop not null;
alter table community_messages add column if not exists bot_type text;
alter table community_messages add column if not exists ai_source_message_id bigint references community_messages(id) on delete cascade;
alter table community_messages add constraint community_message_author_kind_check check
 ((sender_id is not null and bot_type is null and ai_source_message_id is null)
  or (sender_id is null and bot_type='traksbot' and ai_source_message_id is not null));
create unique index if not exists community_bot_once_per_question
 on community_messages(ai_source_message_id) where ai_source_message_id is not null;

create table if not exists community_ai_requests (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references community_rooms(id) on delete cascade,
 source_message_id bigint not null unique references community_messages(id) on delete cascade,
 requester_id uuid not null references users(id) on delete cascade,
 tone text not null check(tone in ('straight','humor','road')),
 consent_at timestamptz not null,
 state text not null default 'processing' check(state in ('processing','published','failed','revoked')),
 error_code text,
 response_message_id bigint references community_messages(id) on delete set null,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists community_ai_requests_user_quota on community_ai_requests(requester_id,created_at desc);
create index if not exists community_ai_requests_room_quota on community_ai_requests(room_id,created_at desc);
comment on table community_ai_requests is
 'Per-message consent to transmit this public question only. No private context or automatic room reading.';
