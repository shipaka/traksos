-- Preserve exactly the audited dispatch order. No geocoding or ETA.
alter table shop_courier_runs
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists route_planning text not null default 'manual_coordinates_missing'
    check (route_planning in ('manual_coordinates_missing','coordinate_heuristic')),
  add column if not exists route_direct_km double precision;
alter table shop_courier_runs
  add constraint shop_courier_pickup_coordinate_pair check (
    (pickup_lat is null and pickup_lng is null) or
    (pickup_lat between -90 and 90 and pickup_lng between -180 and 180)
  );
