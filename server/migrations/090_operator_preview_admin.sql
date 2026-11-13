-- One-time VPS administrator preview: short-lived password and sessions.
-- Default NULL keeps every existing normal account unchanged.
alter table users add column if not exists admin_preview_until timestamptz;
