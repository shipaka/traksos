-- Regional consent is selected by the customer. IP is never trusted as the sale region.
-- This is a storefront eligibility preference, NOT a proof of a delivery address.
create table if not exists shop_customer_regions (
  user_id uuid primary key references users(id) on delete cascade,
  city_label text not null check (char_length(city_label) between 2 and 80),
  city_code text not null check (city_code in ('spb','other')),
  selected_at timestamptz not null default now()
);
create index if not exists shop_customer_regions_code on shop_customer_regions(city_code);
