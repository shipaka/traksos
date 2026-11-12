-- Durable SMS budget shared by all server instances and preserved through restarts.
-- A phone has at most 8 codes per UTC day; an external IP at most 15 per UTC hour.
create table if not exists auth_sms_limits (
  scope text not null check (scope in ('phone_day', 'ip_hour')),
  identity text not null,
  bucket timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (scope, identity, bucket)
);
create index if not exists auth_sms_limits_bucket_idx on auth_sms_limits(bucket);
