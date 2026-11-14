-- Warranty remediation is a separate, non-billable service task linked to
-- the original incident. It must never enter the customer billing pipeline.
create table warranty_rework_jobs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references warranty_claims(id),
  original_order_id uuid not null references orders(id),
  case_root_id uuid not null references orders(id),
  client_id uuid not null references users(id),
  performer_id uuid not null references users(id),
  original_performer_id uuid not null references users(id),
  funding_source text not null check (funding_source in ('performer_in_kind','platform')),
  budget_kopecks integer not null check (budget_kopecks between 0 and 100000000),
  status text not null default 'offered' check (status in
    ('offered','accepted','declined','client_declined','reported_done','client_confirmed')),
  task_description text not null check (char_length(task_description) between 10 and 2000),
  report text,
  authorized_by uuid not null references users(id),
  authorized_at timestamptz not null default now(),
  client_approved_at timestamptz,
  accepted_at timestamptz,
  reported_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((funding_source='performer_in_kind' and budget_kopecks=0
          and performer_id=original_performer_id)
      or (funding_source='platform' and performer_id<>original_performer_id
          and budget_kopecks>0))
);
-- A declined offer can be replaced following explicit new review, but an
-- accepted or completed remedy must never be duplicated by two clicks.
create unique index warranty_rework_active_claim on warranty_rework_jobs(claim_id)
 where status not in ('declined','client_declined');
create index warranty_rework_performer on warranty_rework_jobs(performer_id,status);
create index warranty_rework_case on warranty_rework_jobs(case_root_id,authorized_at);

create table warranty_rework_events (
  id bigserial primary key,
  job_id uuid not null references warranty_rework_jobs(id),
  actor_id uuid references users(id),
  event text not null check (event in ('offered','client_approved','client_declined','accepted','declined','reported_done','client_confirmed','expense_recorded')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index warranty_rework_events_job on warranty_rework_events(job_id,id);

-- These are only independently verified OUTGOING platform transfers.
-- A booked budget is not an expense, and recording this proof does not
-- itself initiate a bank transfer or debit a performer.
create table warranty_platform_expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references warranty_rework_jobs(id),
  amount_kopecks integer not null check (amount_kopecks>0),
  bank_reference text not null unique check (char_length(bank_reference) between 5 and 120),
  transferred_at timestamptz not null,
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now()
);
create table warranty_platform_expense_ledger (
  id bigserial primary key,
  expense_id uuid not null references warranty_platform_expenses(id),
  account text not null check (account in ('platform','warranty_expense')),
  amount_kopecks integer not null,
  created_at timestamptz not null default now(),
  unique(expense_id,account)
);
