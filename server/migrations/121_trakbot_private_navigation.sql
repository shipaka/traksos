-- Navigation suggestions are chosen from a server-side allowlist,
-- attached only to private bot messages and displayed on explicit user tap.
alter table trakbot_messages add column if not exists action_path text;
alter table trakbot_messages add column if not exists action_label text;
