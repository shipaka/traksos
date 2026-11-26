-- КПП: explicit scoped, time-limited, withdrawable location consent.
-- Keep append-only permission history separate from the legally unverified
-- GPS evidence snapshot. Does not change payments or SOS state machines.
alter table performer_route_samples
  add column if not exists checkpoint_plan_id uuid references checkpoint_evidence_plans(id);

-- The exact grant EPOCH is stored after the consent event table below.
-- This prevents a grant/revoke/grant sequence from accidentally reusing
-- precise positions collected under an earlier, withdrawn permission.

create table if not exists checkpoint_gps_consent_events (
 seq bigserial primary key,
 plan_id uuid not null references checkpoint_evidence_plans(id) on delete restrict,
 order_id uuid not null references orders(id) on delete cascade,
 performer_id uuid not null references users(id),
 event_key text not null check(char_length(event_key) between 8 and 160),
 request_hash char(64) not null check(request_hash ~ '^[a-f0-9]{64}$'),
 action text not null check(action in ('granted','revoked')),
 duration_minutes integer,
 expires_at timestamptz,
 recorded_at timestamptz not null default now(),
 check ((action='granted' and duration_minutes between 5 and 180 and expires_at is not null)
     or (action='revoked' and duration_minutes is null and expires_at is null)),
 unique(plan_id,event_key)
);
create index if not exists checkpoint_gps_consent_by_plan
 on checkpoint_gps_consent_events(plan_id,seq desc);

alter table performer_route_samples
 add column if not exists checkpoint_consent_seq bigint
   references checkpoint_gps_consent_events(seq);

-- A legacy staged row may carry checkpoint_consent=true without a scope.
-- NOT VALID preserves such rows for review, but every NEW row must contain
-- both the exact plan and the consent-grant epoch.
alter table performer_route_samples
 add constraint checkpoint_consent_requires_scope
   check (not checkpoint_consent or
     (checkpoint_plan_id is not null and checkpoint_consent_seq is not null))
   not valid;

create index if not exists performer_route_samples_plan_consent_recent
 on performer_route_samples(checkpoint_plan_id,checkpoint_consent_seq,
   performer_id,received_at desc)
 where accepted=true and checkpoint_consent=true;

-- Consent history is append-only. Revocation is a new event, not a rewrite.
create trigger checkpoint_consent_events_immutable
 before update or delete on checkpoint_gps_consent_events
 for each row execute function checkpoint_evidence_immutable();
