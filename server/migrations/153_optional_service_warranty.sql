-- Optional contractual warranty from the performer or service center;
-- NULL never waives rights the customer has under applicable law.
alter table orders
  add column if not exists warranty_days smallint check (warranty_days in (7,14,30)),
  add column if not exists warranty_work_summary varchar(300),
  add column if not exists warranty_started_at timestamptz;
alter table service_bookings
  add column if not exists warranty_days smallint check (warranty_days in (7,14,30)),
  add column if not exists warranty_work_summary varchar(300),
  add column if not exists warranty_started_at timestamptz;
comment on column orders.warranty_days is 'Optional additional performer warranty. NULL is not a waiver of statutory rights.';
comment on column service_bookings.warranty_days is 'Optional additional service-center warranty. NULL is not a waiver of statutory rights.';
