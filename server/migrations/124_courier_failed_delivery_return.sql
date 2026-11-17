-- Exception workflow for a courier who cannot hand over a parcel.
-- A run is not complete until undelivered parcels return to the warehouse.
alter table shop_courier_runs drop constraint if exists shop_courier_runs_status_check;
alter table shop_courier_runs
  add constraint shop_courier_runs_status_check
  check (status in ('planned','accepted','collecting','delivering','returning','completed','cancelled'));
drop index if exists shop_courier_one_active_run;
create unique index shop_courier_one_active_run on shop_courier_runs(courier_id)
  where status in ('planned','accepted','collecting','delivering','returning');
