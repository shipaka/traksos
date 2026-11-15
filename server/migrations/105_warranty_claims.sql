-- Warranty complaints are distinct from price disputes and are NOT a
-- source of automatic refunds, sanctions or performer deductions.
-- Decisions are review recommendations until fulfilment is separately booked.
create table warranty_claims (
  id uuid primary key default gen_random_uuid(),
  number bigserial unique,
  order_id uuid not null references orders(id),
  case_root_id uuid not null references orders(id),
  client_id uuid not null references users(id),
  filed_by uuid not null references users(id),
  performer_id uuid not null references users(id),
  defect_description text not null check (char_length(defect_description) between 10 and 2000),
  evidence_description text,
  requested_remedy text not null check (requested_remedy in
    ('rework','alternative','partial_refund','full_refund','assessment')),
  status text not null default 'submitted' check (status in
    ('submitted','reviewing','decision_recorded','appealed')),
  performer_position text check (performer_position in
    ('offer_rework','contest_fault','needs_evidence','unavailable')),
  performer_explanation text,
  performer_responded_at timestamptz,
  decision text check (decision in
    ('not_fault','repair_by_original','repair_by_alternative',
     'partial_refund','full_refund','needs_external_review')),
  decision_note text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  appeal_count integer not null default 0 check (appeal_count between 0 and 1),
  appealed_by uuid references users(id),
  appealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One investigated defect per underlying completed order at a time. Further
-- materials belong to the claim's evidence log instead of duplicate cases.
create unique index warranty_claims_order_unique on warranty_claims(order_id);
create index warranty_claims_staff_queue on warranty_claims(status,created_at);
create index warranty_claims_client on warranty_claims(client_id,created_at desc);
create index warranty_claims_performer on warranty_claims(performer_id,created_at desc);

create table warranty_claim_events (
  id bigserial primary key,
  claim_id uuid not null references warranty_claims(id) on delete cascade,
  actor_id uuid references users(id),
  event text not null check (event in
    ('opened','evidence_added','performer_responded','review_started',
     'decision_recorded','decision_appealed')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index warranty_events_claim on warranty_claim_events(claim_id,id);
