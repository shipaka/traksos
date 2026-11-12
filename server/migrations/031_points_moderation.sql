-- Idempotent point events and moderator-controlled reward holds.
-- Existing entries remain available; new event keys enforce one award/spend per source.
alter table points_entries add column if not exists event_key text;
alter table points_entries add column if not exists status text not null default 'available';
alter table points_entries add column if not exists moderated_by uuid references users(id);
alter table points_entries add column if not exists moderated_at timestamptz;
alter table points_entries add column if not exists moderation_reason text;
create unique index if not exists points_event_key_unique on points_entries(event_key) where event_key is not null;
create index if not exists points_status_user on points_entries(user_id,status);
