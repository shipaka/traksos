-- Checkpoint (КПП) evidence: isolated, non-billable, manual-review workflow.
-- Migration intentionally does NOT alter order state, pricing, payment, or
-- public API. New GPS metadata fields are nullable: legacy routes remain
-- review-only, never silently considered accurate GPS arrival.
alter table performer_route_samples
  add column if not exists accuracy_m double precision
    check (accuracy_m is null or (accuracy_m > 0 and accuracy_m <= 10000));
alter table performer_route_samples
  add column if not exists gps_source text not null default 'unknown'
    check (gps_source in ('gps','network','predicted','unknown'));
alter table performer_route_samples
  add column if not exists mock_location boolean not null default false;
-- Source/accuracy are client-reported (NOT platform GPS attestation).
-- Only the explicitly consented, correct-plan samples are considered.
alter table performer_route_samples
  add column if not exists checkpoint_consent boolean not null default false;
alter table performer_route_samples
  add column if not exists device_at timestamptz;

create table if not exists checkpoint_evidence_plans (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  performer_id uuid not null references users(id),
  plan_key text not null check (char_length(plan_key) between 8 and 120),
  version integer not null check (version >= 1),
  supersedes_id uuid references checkpoint_evidence_plans(id),
  checkpoint_lat double precision not null check(checkpoint_lat between -90 and 90),
  checkpoint_lng double precision not null check(checkpoint_lng between -180 and 180),
  radius_m integer not null check(radius_m between 50 and 500),
  requires_pass boolean not null,
  location_description text check(char_length(location_description) <= 500),
  approved_by uuid not null references users(id),
  client_approved_at timestamptz not null default now(),
  request_hash char(64) not null check (request_hash ~ '^[a-f0-9]{64}$'),
  unique(order_id, plan_key),
  unique(order_id, version)
);
create index if not exists checkpoint_evidence_plan_order
  on checkpoint_evidence_plans(order_id,version desc);

-- Document exchange, consent and signature validation are NOT implemented here.
-- This merely journals an administrator's manual verification of a pass.
create table if not exists checkpoint_pass_reviews (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references checkpoint_evidence_plans(id) on delete restrict,
  event_key text not null unique check (char_length(event_key) between 8 and 160),
  outcome text not null check (outcome in ('cleared','blocked')),
  evidence_ref text not null check (char_length(evidence_ref) between 8 and 500),
  evidence_hash char(64) not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  explanation text not null check (char_length(explanation) between 20 and 2000),
  reviewed_by uuid not null references users(id),
  recorded_at timestamptz not null default now()
);
create index if not exists checkpoint_pass_reviews_plan
  on checkpoint_pass_reviews(plan_id,recorded_at desc,id desc);

-- Each API retry with the same request_key is identical; a different payload
-- under one key must fail. Evaluation/snapshot are frozen at ingestion time.
create table if not exists checkpoint_arrival_attempts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references checkpoint_evidence_plans(id) on delete restrict,
  order_id uuid not null references orders(id) on delete cascade,
  performer_id uuid not null references users(id),
  request_key text not null check (char_length(request_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[a-f0-9]{64}$'),
  explanation text,
  outcome text not null check(outcome in ('candidate','needs_review')),
  evaluation jsonb not null,
  sample_digest char(64) not null check (sample_digest ~ '^[a-f0-9]{64}$'),
  sample_count integer not null check(sample_count between 0 and 200),
  gps_consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(plan_id,request_key),
  check (jsonb_typeof(evaluation)='object')
);
create index if not exists checkpoint_attempts_order_recent
  on checkpoint_arrival_attempts(order_id,created_at desc);
create index if not exists checkpoint_attempts_plan_recent
  on checkpoint_arrival_attempts(plan_id,created_at desc);

-- Raw GPS snapshots have an independently purgeable retention period.
-- A signed legal-hold/dispute policy is required before production activation.
create table if not exists checkpoint_arrival_sample_snapshots (
  attempt_id uuid primary key references checkpoint_arrival_attempts(id) on delete cascade,
  sample_snapshot jsonb not null check (jsonb_typeof(sample_snapshot)='array'),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists checkpoint_arrival_snapshots_expiry
  on checkpoint_arrival_sample_snapshots(expires_at);

-- Explicit human disposition; still does NOT start paid time or mutate an
-- existing order status. One decision per attempt to prevent contradictory
-- "proof"; mistakes require a separate documented dispute mechanism.
create table if not exists checkpoint_arrival_decisions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references checkpoint_arrival_attempts(id) on delete restrict,
  order_id uuid not null references orders(id) on delete cascade,
  decision text not null check(decision in ('corroborated','insufficient')),
  explanation text not null check(char_length(explanation) between 20 and 2000),
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now()
);
create index if not exists checkpoint_decisions_order
  on checkpoint_arrival_decisions(order_id,decided_at desc);

-- Evidence is append-only; pass review and later changes are separate events.
create or replace function checkpoint_evidence_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Checkpoint evidence is immutable; append a new case/event instead';
end $$;
create trigger checkpoint_plans_immutable before update or delete on checkpoint_evidence_plans
for each row execute function checkpoint_evidence_immutable();
create trigger checkpoint_reviews_immutable before update or delete on checkpoint_pass_reviews
for each row execute function checkpoint_evidence_immutable();
create trigger checkpoint_attempts_immutable before update or delete on checkpoint_arrival_attempts
for each row execute function checkpoint_evidence_immutable();
create trigger checkpoint_decisions_immutable before update or delete on checkpoint_arrival_decisions
for each row execute function checkpoint_evidence_immutable();
-- Delete expired precise GPS, but never rewrite the stored snapshot.
create trigger checkpoint_snapshots_immutable before update on checkpoint_arrival_sample_snapshots
for each row execute function checkpoint_evidence_immutable();
