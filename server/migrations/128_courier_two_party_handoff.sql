-- One-time two-person proof of parcel handoff. The client receives a code
-- only after the courier marks the currently active stop "arrived"; the courier
-- verifies it, then the buyer separately confirms the physical delivery.
-- NO plaintext PIN is stored. Unsuccessful guesses are counted under a row lock.
create table if not exists shop_delivery_handoffs (
  stop_id uuid primary key references shop_courier_stops(id) on delete cascade,
  code_salt text not null check(length(code_salt)=32),
  code_hash text not null check(length(code_hash)=64),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check(attempts between 0 and 5),
  verified_at timestamptz,
  verified_by uuid references shop_couriers(user_id) on delete set null,
  constraint handoff_expiry_after_issue check(expires_at>issued_at)
);
create index if not exists shop_delivery_handoffs_expire
  on shop_delivery_handoffs(expires_at) where verified_at is null;
-- Store an auditable but customer-safe handoff event, not the PIN or recipient ID.
alter table shop_delivery_events drop constraint if exists shop_delivery_events_status_check;
alter table shop_delivery_events add constraint shop_delivery_events_status_check
  check(status in ('planned','accepted','collected','dispatched','arrived',
    'handoff_verified','delivered','failed','returned','route_cancelled'));
