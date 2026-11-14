-- Online work payment creation: write the exact provider request before bank IO.
-- A missing network response may be retried with the SAME idempotency key only
-- while the provider's 24h replay guarantee is valid.
create table payment_create_intents (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references payments(id),
  order_id uuid not null unique references orders(id),
  request jsonb not null,
  status text not null default 'prepared'
    check(status in ('prepared','sending','needs_review','ready')),
  attempts integer not null default 0 check(attempts >= 0),
  first_sent_at timestamptz,
  last_attempt_at timestamptz,
  checked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(request) = 'object')
);

create index payment_create_intents_pending
 on payment_create_intents(created_at)
 where status in ('prepared','sending','needs_review');

-- One external transaction must never back two different internal payments.
create unique index if not exists payments_unique_provider_reference
 on payments(provider, provider_payment_id)
 where provider_payment_id is not null;
