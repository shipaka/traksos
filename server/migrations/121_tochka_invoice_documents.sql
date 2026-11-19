-- Tochka document issuance journal. Bank-side creation is not idempotent: once a
-- request is sent, ambiguous responses MUST go to manual review, never retry.
-- No money is considered received merely because an invoice exists.
create table if not exists tochka_invoice_documents (
  payment_id uuid primary key references payments(id) on delete restrict,
  order_id uuid not null references orders(id) on delete restrict,
  invoice_number text not null unique,
  bank_document_id text unique,
  buyer_inn text not null,
  total_kopecks bigint not null check (total_kopecks > 0),
  status text not null check (status in ('sending','issued','needs_review')),
  bank_payment_status text check (bank_payment_status in
    ('payment_waiting','payment_paid','payment_expired')),
  last_error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tochka_invoice_order on tochka_invoice_documents(order_id);
