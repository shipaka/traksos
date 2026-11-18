
-- Privacy-first draft handoff. No guest name/phone/address/VIN/coordinates are collected.
-- Intent is NOT verified consent, dispatch, a customer account or a payable lead.
create table if not exists external_handoff_drafts (
  id uuid primary key,
  created_by uuid not null references users(id),
  request_key text not null,
  request_hash char(64) not null,
  invite_token_hash char(64) not null unique,
  service text not null check (service in ('diag','electric','air','autonomy','tyre','tow','ecu')),
  vehicle_kind text not null check (vehicle_kind in ('tractor','truck','trailer','bus','special')),
  issue_code text not null check (issue_code in ('engine','electrical','brakes','pneumatics','tyres','battery','transport','other')),
  region text not null check (region in ('spb','lo')),
  timing text not null check (timing in ('urgent','today','tomorrow','flexible')),
  status text not null default 'draft'
     check (status in ('draft','interest_recorded','revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  interest_at timestamptz,
  unique(created_by,request_key)
);
create index if not exists external_handoff_owner_idx
  on external_handoff_drafts(created_by,created_at desc);
create index if not exists external_handoff_expiration_idx
  on external_handoff_drafts(expires_at) where status='draft';
-- No payout, customer personal data, search broadcast, public directory or SMS triggers.
