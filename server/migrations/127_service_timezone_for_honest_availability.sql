-- A confirmed facility must supply its real local timezone before we promote it as open now.
-- Existing records remain null. No guess from visitor IP, address substring, or location is made.
alter table service_centers add column if not exists time_zone text;
alter table service_centers add constraint service_centers_time_zone_length
  check(time_zone is null or (length(time_zone) between 3 and 80));

-- Coarse latitude prefilter plus recent confirmation keeps driver lookups bounded
-- without returning exact provider positions to the driver.
create index if not exists service_centers_live_region
  on service_centers(lat,accepts_confirmed_at)
  where verification='approved' and paused=false and lat is not null;
create index if not exists performer_profiles_live_region
  on performer_profiles(lat,location_at)
  where verification='approved' and paused=false and line_status='online' and lat is not null;
