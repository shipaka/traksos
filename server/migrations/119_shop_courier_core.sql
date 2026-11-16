-- TrackSOS in-house last-mile: city-limited parts delivery, no freight marketplace.
-- Courier identity is admin-provisioned separately from master/driver roles.
create table if not exists shop_couriers (
 user_id uuid primary key references users(id) on delete cascade,
 display_name text not null,
 vehicle_label text,
 active boolean not null default true,
 location_consent boolean not null default false,
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

-- Manual review until a licensed geocoder and official service-area polygon
-- are integrated. A free-form address or an IP address is NOT proof of SPb.
create table if not exists shop_delivery_address_checks (
 shop_order_id uuid primary key references shop_orders(id) on delete cascade,
 city_code text not null check (city_code='spb'),
 reviewed_by uuid not null references users(id),
 review_note text not null check (length(review_note) between 10 and 500),
 lat double precision,
 lng double precision,
 reviewed_at timestamptz not null default now(),
 check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180))
);

create table if not exists shop_courier_runs (
 id uuid primary key default gen_random_uuid(),
 courier_id uuid not null references shop_couriers(user_id),
 created_by uuid not null references users(id),
 pickup_address text not null,
 city_code text not null default 'spb' check (city_code='spb'),
 status text not null default 'planned'
   check (status in ('planned','accepted','collecting','delivering','completed','cancelled')),
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 departed_at timestamptz,
 completed_at timestamptz
);
-- One operational route per courier; no concurrent revealing of other customers.
create unique index if not exists shop_courier_one_active_run
 on shop_courier_runs(courier_id) where status in ('planned','accepted','collecting','delivering');
create index if not exists shop_courier_runs_status on shop_courier_runs(status,created_at desc);

create table if not exists shop_courier_stops (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references shop_courier_runs(id) on delete cascade,
 shop_order_id uuid not null unique references shop_orders(id),
 seq integer not null check (seq between 1 and 100),
 status text not null default 'awaiting_pickup'
   check (status in ('awaiting_pickup','collected','at_door','delivered','failed')),
 collected_at timestamptz,
 arrived_at timestamptz,
 delivered_at timestamptz,
 failed_reason text,
 unique(run_id,seq)
);
create index if not exists shop_courier_stops_run on shop_courier_stops(run_id,seq);
create index if not exists shop_courier_stops_order on shop_courier_stops(shop_order_id);

-- Store ONE current fix, not a continuous location history. Delete on route end.
create table if not exists shop_courier_live_positions (
 run_id uuid primary key references shop_courier_runs(id) on delete cascade,
 lat double precision not null check (lat between -90 and 90),
 lng double precision not null check (lng between -180 and 180),
 accuracy_m integer not null check (accuracy_m between 1 and 500),
 updated_at timestamptz not null default now()
);

-- Select ONE recipient leg: otherwise all recipients in a route would see
-- the courier's exact location while visiting somebody else.
alter table shop_courier_runs add column if not exists active_stop_id uuid references shop_courier_stops(id) on delete set null;
