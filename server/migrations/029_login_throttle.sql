-- Shared password-login brute-force protection across restarts and app replicas.
create table if not exists auth_login_attempts (
  scope text not null check (scope in ('phone', 'ip')),
  identity text not null,
  window_start timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (scope, identity)
);
create index if not exists auth_login_attempts_window_idx on auth_login_attempts(window_start);
