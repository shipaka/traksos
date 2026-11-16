-- The event feed is a bounded delivery log, NOT a permanent archive.
-- A scope epoch lets reconnecting devices detect history pruned after their
-- last event cursor and discard cached (memory-only) tombstoned messages.
alter table community_rooms add column if not exists event_epoch bigint not null default 0;
alter table community_dm_threads add column if not exists event_epoch bigint not null default 0;

create index if not exists community_room_events_retention
  on community_room_moderation_events(changed_at,room_id,id);
create index if not exists community_dm_events_retention
  on community_dm_moderation_events(changed_at,thread_id,id);
