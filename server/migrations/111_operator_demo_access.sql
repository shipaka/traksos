-- Isolated one-time owner demo access. These are NOT user/session credentials.
-- A demo session never grants an application role or access to protected API endpoints.
create table if not exists operator_demo_grant (
  id integer primary key check (id = 1),
  pin_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  redeemed_at timestamptz
);
create table if not exists operator_demo_session (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists operator_demo_session_expiry on operator_demo_session(expires_at);
