-- Cancellation of a courier route before any parcel is collected.
-- The audit trail survives; stops may be reassigned to a replacement route.
alter table shop_courier_runs
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references users(id) on delete set null,
  add column if not exists cancellation_reason text;
