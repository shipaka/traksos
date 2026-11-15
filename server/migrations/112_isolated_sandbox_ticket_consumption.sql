-- One-time handoff from the primary admin session to a completely separate
-- sandbox instance. Tokens are never accepted as normal site sessions.
create table if not exists sandbox_ticket_uses (
  nonce_hash text primary key,
  expires_at timestamptz not null
);
create index if not exists sandbox_ticket_uses_expires_idx on sandbox_ticket_uses (expires_at);
