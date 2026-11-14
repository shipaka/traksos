-- Case-only linkage for a standalone workshop booking after tow.
-- from_order_id retains its existing 'recommended by master' discount meaning.
alter table service_bookings
  add column if not exists case_root_id uuid references orders(id);
create index if not exists service_bookings_case_root_idx
  on service_bookings(case_root_id, created_at)
  where case_root_id is not null;
