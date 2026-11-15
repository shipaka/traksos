-- An investigated warranty expense may give rise to a separate potential
-- recourse claim against the actual original executor.
-- This is NOT a debit, enforced debt, sanction or payout hold.
create table warranty_recourse_cases (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique references warranty_platform_expenses(id),
  warranty_claim_id uuid not null references warranty_claims(id),
  original_performer_id uuid not null references users(id),
  proposed_amount_kopecks integer not null check (proposed_amount_kopecks>0),
  contractual_basis text not null check (char_length(contractual_basis) between 20 and 2000),
  evidence_summary text not null check (char_length(evidence_summary) between 20 and 2000),
  status text not null default 'notified'
    check(status in ('notified','contested','acknowledged','reviewed','withdrawn')),
  performer_position text check (performer_position in ('acknowledged','contested')),
  performer_explanation text,
  responded_at timestamptz,
  review_outcome text check(review_outcome in
    ('documented_for_review','insufficient_basis','external_legal_review')),
  review_reason text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  opened_by uuid not null references users(id),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index warranty_recourse_by_performer
 on warranty_recourse_cases(original_performer_id,opened_at desc);
create index warranty_recourse_staff_queue
 on warranty_recourse_cases(status,opened_at);
create table warranty_recourse_events (
  id bigserial primary key,
  case_id uuid not null references warranty_recourse_cases(id),
  actor_id uuid references users(id),
  event text not null check(event in
    ('notified','acknowledged','contested','reviewed','withdrawn','received_payment')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index warranty_recourse_events_case
 on warranty_recourse_events(case_id,id);

-- Cash recovery can only be recorded against a verified RECEIVED transfer.
-- It never triggers a bank action, payout offset or contractor freeze.
create table warranty_recourse_receipts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references warranty_recourse_cases(id),
  amount_kopecks integer not null check(amount_kopecks>0),
  bank_reference text not null unique check(char_length(bank_reference) between 5 and 120),
  received_at timestamptz not null,
  confirmed_by uuid not null references users(id),
  recorded_at timestamptz not null default now()
);
create index warranty_recourse_receipts_case on warranty_recourse_receipts(case_id);
create table warranty_recourse_receipt_ledger (
  id bigserial primary key,
  receipt_id uuid not null references warranty_recourse_receipts(id),
  account text not null check(account in ('platform','warranty_recourse_received')),
  amount_kopecks integer not null,
  unique(receipt_id,account)
);
