-- Persist the intention to capture a held call-out BEFORE contacting a bank.
-- A lost network response or a rolled-back accounting transaction must never
-- trigger an unrecorded second capture. One intent per held payment and order.
create table payment_capture_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  payment_id uuid not null unique references payments(id),
  provider_payment_id text not null,
  amount integer not null check (amount >= 0),
  client_fee integer not null,
  total integer not null check (total >= 0),
  status text not null default 'prepared'
    check (status in ('prepared','sending','needs_review','settled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  attempted_at timestamptz,
  checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prepared intents can be sent exactly once; 'sending' and 'needs_review'
-- must be reconciled against the bank, NEVER automatically resubmitted.
create index payment_capture_intents_unresolved
  on payment_capture_intents(created_at)
  where status in ('prepared','sending','needs_review');
