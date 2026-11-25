-- Delivery workflow for the separately approved courier role (20 Nov).
-- A courier never receives rights over arbitrary shop orders.
-- Completion requires two independent authenticated actors:
-- courier verifies customer receipt code, customer confirms actual receipt.
create table if not exists shop_courier_deliveries (
  id uuid primary key default gen_random_uuid(),
  shop_order_id uuid not null unique references shop_orders(id) on delete restrict,
  courier_id uuid not null references users(id) on delete restrict,
  status text not null default 'assigned'
    check (status in ('assigned','picked_up','en_route','arrived','code_verified','received','cancelled')),
  code_nonce uuid not null default gen_random_uuid(),
  code_attempts integer not null default 0 check (code_attempts between 0 and 5),
  code_resets integer not null default 0 check (code_resets between 0 and 3),
  code_expires_at timestamptz not null default (now() + interval '24 hours'),
  code_verified_at timestamptz,
  received_at timestamptz,
  assigned_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_courier_received_must_have_proof
    check (status <> 'received' or (code_verified_at is not null and received_at is not null))
);
create index if not exists shop_courier_deliveries_courier_active
  on shop_courier_deliveries(courier_id,updated_at desc)
  where status <> 'received' and status <> 'cancelled';

-- Availability is separate from route progress, and stays server-backed even
-- when Android goes to the background. Offline must not erase assigned trips.
create table if not exists shop_courier_presence (
  courier_id uuid primary key references users(id) on delete cascade,
  online boolean not null default false,
  updated_at timestamptz not null default now()
);
