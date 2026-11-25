-- Checkpoint GPS privacy operations: immutable, count-only destruction receipts.
-- This is a SANDBOX-only capability until an approved retention schedule,
-- legal-hold process and backup deletion procedure are adopted.
create table if not exists checkpoint_gps_purge_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique check(char_length(batch_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid not null references users(id),
  cutoff_at timestamptz not null,
  sample_cutoff_at timestamptz not null,
  deleted_snapshots integer not null check (deleted_snapshots >= 0),
  deleted_samples integer not null check (deleted_samples >= 0),
  created_at timestamptz not null default now()
);
create index if not exists checkpoint_route_samples_purge_due
  on performer_route_samples(received_at)
  where checkpoint_consent=true and checkpoint_plan_id is not null;

-- Immutable receipts demonstrate which housekeeping batch removed raw GPS,
-- without storing any coordinates or subject phone numbers.
create trigger checkpoint_gps_purge_batches_immutable
  before update or delete on checkpoint_gps_purge_batches
  for each row execute function checkpoint_evidence_immutable();
