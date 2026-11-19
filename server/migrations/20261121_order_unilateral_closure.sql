-- Voluntary operational handoff when a customer cannot respond.
-- This is NOT consent to the bill, confirmation of payment, capture or payout.
create table if not exists order_unilateral_closures (
  order_id uuid primary key references orders(id) on delete restrict,
  performer_id uuid not null references users(id),
  request_key uuid not null unique,
  work_amount integer not null check (work_amount >= 0),
  bill_snapshot jsonb not null,
  reason text not null check (reason in ('no_connection','phone_unavailable','customer_absent','other')),
  comment text not null check (char_length(comment) between 10 and 1500),
  evidence_refs text[] not null default '{}'::text[],
  physical_work_confirmed boolean not null check (physical_work_confirmed=true),
  status text not null default 'pending_client' check (status in ('pending_client','accepted','disputed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references users(id),
  decision_reason text,
  check (cardinality(evidence_refs) <= 8),
  check (status='pending_client' or (responded_by is not null and responded_at is not null))
);
create index if not exists order_unilateral_queue_idx
  on order_unilateral_closures(status,created_at desc);
