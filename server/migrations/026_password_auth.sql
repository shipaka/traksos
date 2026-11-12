-- Password login without per-visit SMS. Existing users set a password through recovery.
alter table users add column if not exists password_hash text;
alter table auth_codes add column if not exists purpose text not null default 'register'
  check (purpose in ('register','reset'));
