-- Prevent repeated bulk notifications for the same worker announcement.
alter table worker_announcements add column if not exists notified_at timestamptz;
alter table worker_announcements add column if not exists notified_count integer not null default 0;
