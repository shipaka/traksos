-- A supplementary ECU job is its own priced, dispatched contract, not a
-- modification of the original mechanic's invoice, payment or responsibility.
-- All jobs in the same repair case share case_root_id; no cross-role data grant.
alter table orders
  add column if not exists additional_to uuid references orders(id) on delete set null;
create index if not exists orders_additional_to_idx
  on orders(additional_to) where additional_to is not null;
-- Fail closed on a double-click/network replay for the same ECU add-on.
-- A deliberately new expert stage can be linked to another completed stage.
create unique index if not exists orders_one_live_ecu_additional_idx
  on orders(additional_to)
  where service='ecu' and additional_to is not null
    and status not in ('cancelled','no_performer');

create table if not exists order_ecu_referrals (
  id uuid primary key default gen_random_uuid(),
  source_order_id uuid not null references orders(id) on delete cascade,
  suggested_by uuid references users(id) on delete set null,
  reason text not null check(length(trim(reason)) between 20 and 800),
  status text not null default 'pending' check(status in ('pending','used','declined')),
  linked_order_id uuid unique references orders(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);
create unique index if not exists order_ecu_one_pending_per_source_idx
  on order_ecu_referrals(source_order_id) where status='pending';
create index if not exists order_ecu_referrals_source_idx
  on order_ecu_referrals(source_order_id,created_at desc);
