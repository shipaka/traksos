-- Durable refund attempts: a provider timeout must never turn into a second transfer.
create table payment_refund_requests (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  requested_by uuid not null references users(id),
  idempotency_key text not null,
  amount integer not null check (amount > 0),
  source_account text not null check (source_account in ('platform','performer')),
  reason text not null,
  status text not null default 'processing'
    check (status in ('processing','pending','needs_review','succeeded','failed')),
  provider_refund_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (payment_id, idempotency_key)
);
create index payment_refund_requests_unresolved
  on payment_refund_requests(payment_id)
  where status in ('processing','pending','needs_review');
