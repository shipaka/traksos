-- SТО/repair invoice 5% customer surcharge is a separate snapshotted component.
-- Legacy invoices remain EXACTLY as before (client_fee=0, payment_required=false).
-- New invoices require separately attested incoming funds before being marked paid out.
alter table service_bookings add column if not exists client_fee integer not null default 0
  check (client_fee between 0 and 500000);
alter table service_bookings add column if not exists client_fee_pct numeric(5,2) not null default 0
  check (client_fee_pct between 0 and 100);
alter table service_bookings add column if not exists payment_required boolean not null default false;
alter table service_bookings add column if not exists received_amount integer not null default 0
  check (received_amount >= 0);
alter table service_bookings add column if not exists refunded_amount integer not null default 0
  check (refunded_amount >= 0 and refunded_amount <= received_amount);

create table if not exists service_payment_events (
  id bigserial primary key,
  booking_id uuid not null references service_bookings(id),
  kind text not null check(kind in ('receipt','refund')),
  amount integer not null check(amount > 0),
  method text not null check(method in ('invoice','online','cash','other')),
  reference text not null check (char_length(reference) between 4 and 200),
  confirmed_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (kind,method,reference)
);
create index if not exists service_payment_events_booking
  on service_payment_events(booking_id,created_at desc,id desc);

comment on table service_payment_events is
  'Manual accounting attestations with external bank/receipt references; not an actual gateway capture or refund. No automatic transfer.';
