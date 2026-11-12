-- Device push tokens are credentials for notifications and must belong to one live session.
-- Existing rows are treated as legacy; Android clients will bind them on next launch.
alter table push_tokens add column if not exists session_token_hash text
  references sessions(token_hash) on delete cascade;
create index if not exists push_tokens_session_idx on push_tokens(session_token_hash);
create index if not exists push_tokens_token_idx on push_tokens(provider, token);
