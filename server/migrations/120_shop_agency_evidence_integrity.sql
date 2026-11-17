-- Hardening: the evidentiary archive is append-only at PostgreSQL level,
-- not just via application conventions. No existing sales or payment tables change.
create or replace function shop_agency_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'shop agency evidence is immutable; append a correcting event instead'
    using errcode = '23514';
end;
$$;

drop trigger if exists shop_agency_events_immutable on shop_agency_events;
create trigger shop_agency_events_immutable before update or delete on shop_agency_events
for each row execute function shop_agency_reject_mutation();

drop trigger if exists shop_agency_allocations_immutable on shop_agency_allocations;
create trigger shop_agency_allocations_immutable before update or delete on shop_agency_allocations
for each row execute function shop_agency_reject_mutation();

drop trigger if exists shop_agency_reviews_immutable on shop_agency_reviews;
create trigger shop_agency_reviews_immutable before update or delete on shop_agency_reviews
for each row execute function shop_agency_reject_mutation();

-- The terms and buyer/supplier snapshot cannot be rewritten.
-- Only the append-only evidence counter may advance, precisely by +1.
create or replace function shop_agency_guard_case_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'evidence_version') is distinct from
     (to_jsonb(old) - 'evidence_version')
     or new.evidence_version <> old.evidence_version + 1 then
    raise exception 'shop agency case snapshots are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists shop_agency_cases_immutable on shop_agency_cases;
create trigger shop_agency_cases_immutable before update on shop_agency_cases
for each row execute function shop_agency_guard_case_update();
drop trigger if exists shop_agency_cases_no_delete on shop_agency_cases;
create trigger shop_agency_cases_no_delete before delete on shop_agency_cases
for each row execute function shop_agency_reject_mutation();

-- Original bytes, SHA-256 and document metadata cannot be changed once uploaded.
-- Review may progress exactly once to manually_checked; every review
-- records its actor and note and increments the linked case evidence version.
create or replace function shop_agency_guard_document_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'source' - 'review_note' - 'verified_by' - 'verified_at')
      is distinct from
     (to_jsonb(old) - 'source' - 'review_note' - 'verified_by' - 'verified_at')
     or old.source <> 'manual_unverified'
     or new.source <> 'manually_checked'
     or new.verified_by is null or new.verified_at is null
     or coalesce(length(btrim(new.review_note)), 0) < 8 then
    raise exception 'shop agency document bytes and metadata are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists shop_agency_documents_review_only on shop_agency_documents;
create trigger shop_agency_documents_review_only before update on shop_agency_documents
for each row execute function shop_agency_guard_document_update();
drop trigger if exists shop_agency_documents_no_delete on shop_agency_documents;
create trigger shop_agency_documents_no_delete before delete on shop_agency_documents
for each row execute function shop_agency_reject_mutation();

create index if not exists shop_agency_documents_issue on shop_agency_documents(issued_at, id);
create index if not exists shop_agency_allocations_doc on shop_agency_allocations(document_id, case_id);

-- Immutable, explicitly UNOFFICIAL accounting evidence export snapshots.
-- The payload stores hashes/identifiers and sums, not original private document bytes.
create table if not exists shop_agency_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(request_key) between 8 and 120),
  from_day date not null,
  to_day date not null,
  manifest_sha256 text not null check (length(manifest_sha256) = 64),
  payload jsonb not null,
  note text not null check (length(btrim(note)) >= 8),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (from_day <= to_day)
);
create index if not exists shop_agency_report_snapshots_range
  on shop_agency_report_snapshots(created_at desc, from_day, to_day);
drop trigger if exists shop_agency_snapshots_immutable on shop_agency_report_snapshots;
create trigger shop_agency_snapshots_immutable before update or delete on shop_agency_report_snapshots
for each row execute function shop_agency_reject_mutation();
