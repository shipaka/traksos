-- Durable, privacy-minimal notifications for internal developer reports.
-- Every pre-existing open report becomes eligible for optional webhook delivery.
alter table admin_developer_reports
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_next_at timestamptz not null default now(),
  add column if not exists delivery_lease_until timestamptz,
  add column if not exists delivery_sent_at timestamptz,
  add column if not exists delivery_last_error text;
create index if not exists admin_developer_reports_delivery_due
  on admin_developer_reports(delivery_next_at, created_at)
  where status='queued' and delivery_sent_at is null;
