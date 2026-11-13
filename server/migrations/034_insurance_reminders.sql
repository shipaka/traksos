-- Insurance validity and non-intrusive reminder scheduling.
alter table vehicle_service_requests add column if not exists policy_expires_on date;
alter table vehicle_service_requests add column if not exists reminder_30_sent_at timestamptz;
alter table vehicle_service_requests add column if not exists reminder_7_sent_at timestamptz;
alter table vehicle_service_requests add column if not exists reminder_1_sent_at timestamptz;
create index if not exists vehicle_service_requests_expiry_idx
  on vehicle_service_requests(policy_expires_on)
  where kind='insurance' and status='completed' and policy_expires_on is not null;
