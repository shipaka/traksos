-- Do not put a 90-day login bearer token into a WebSocket URL.
-- Each ticket is random, hashed at rest, one-time and valid for 30 seconds.
-- Existing app versions may use the legacy bearer URL during migration.
create table if not exists realtime_ws_tickets (
  ticket_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists realtime_ws_ticket_expiry on realtime_ws_tickets(expires_at);
create index if not exists realtime_ws_session on realtime_ws_tickets(session_token_hash);

-- Do not rename this migration once it has been applied: schema_migrations keys on its full filename.
