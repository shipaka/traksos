-- #51: per-order wave state for optional, strictly server-routed SOS search.
-- Legacy orders keep wave zero and never change customer-approved tariff.
alter table orders
  add column if not exists sos_dispatch_stage smallint not null default 0;
alter table orders
  add constraint orders_sos_dispatch_stage_range
  check (sos_dispatch_stage between 0 and 5);

-- Verified road ETA is only attached to invited performers with a trusted
-- server-side router. NULL means UNKNOWN, never "30 minutes".
alter table order_dispatch
  add column if not exists road_eta_minutes integer;
alter table order_dispatch
  add constraint order_dispatch_road_eta_positive
  check (road_eta_minutes is null or road_eta_minutes between 0 and 1440);

comment on column orders.sos_dispatch_stage is
  'Current zero-based wave for optionally enabled progressive SOS search; does not affect price';
comment on column order_dispatch.road_eta_minutes is
  'Verified road ETA including preparation, provided by trusted server router; never inferred from Haversine';
