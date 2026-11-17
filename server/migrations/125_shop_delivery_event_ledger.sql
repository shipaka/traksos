-- Customer-safe immutable delivery chronology. Each order may have several
-- courier attempts; replacing a route never removes the shipment's history.
create table if not exists shop_delivery_events (
 id bigint generated always as identity primary key,
 shop_order_id uuid not null references shop_orders(id) on delete cascade,
 run_id uuid references shop_courier_runs(id) on delete set null,
 status text not null check(status in (
  'planned','accepted','collected','dispatched','arrived','delivered',
  'failed','returned','route_cancelled'
 )),
 event_time timestamptz not null default now(),
 actor_id uuid references users(id) on delete set null
);
create index if not exists shop_delivery_events_order on shop_delivery_events(shop_order_id,id desc);
create index if not exists shop_delivery_events_route on shop_delivery_events(run_id,id desc);
