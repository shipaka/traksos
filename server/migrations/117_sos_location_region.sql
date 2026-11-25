-- Region and tariff zone are distinct explicit customer declarations.
-- Existing orders remain legacy (NULL), and their price/cancellation history
-- must not be recalculated when the customer changes the new-order region.
alter table orders add column if not exists location_region text;
alter table orders add constraint orders_location_region_allowed
  check (location_region is null or location_region in ('spb','lo'));
comment on column orders.location_region is
  'Customer-confirmed service region at creation; NULL is a pre-migration order. Not a geocoder verdict.';
