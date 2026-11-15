-- An order cancellation must first commit an immutable bank action plan.
-- Do not call provider.cancel/capture from an uncommitted order transaction.
create table payment_cancel_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  payment_id uuid not null unique references payments(id),
  provider_payment_id text not null,
  action text not null check (action in ('cancel','capture')),
  stage text not null,
  amount_to_capture integer not null default 0 check (amount_to_capture >= 0),
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  to_performer integer not null default 0 check (to_performer >= 0),
  platform_keeps integer not null default 0 check (platform_keeps >= 0),
  commission integer not null default 0 check (commission >= 0),
  status text not null default 'prepared'
    check (status in ('prepared','sending','needs_review','settled')),
  attempts integer not null default 0,
  last_error text,
  attempted_at timestamptz,
  checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_cancel_intents_unresolved
 on payment_cancel_intents(created_at)
 where status in ('prepared','sending','needs_review');
