-- Shop catalog metadata, curated article equivalences and optional vehicle-linked purchases.
-- Existing products and orders remain valid; storefront enabled flag is unchanged.
alter table shop_products add column if not exists brand text;
alter table shop_products add column if not exists article text;
alter table shop_products add column if not exists search_terms text;
create index if not exists shop_products_article_lookup on shop_products(lower(article)) where article is not null;
create index if not exists shop_products_category_lookup on shop_products(category, active, sort, name);
create table if not exists shop_product_analogs (
  product_id uuid not null references shop_products(id) on delete cascade,
  analog_id uuid not null references shop_products(id) on delete cascade,
  verified boolean not null default false,
  source text,
  created_at timestamptz not null default now(),
  primary key (product_id, analog_id),
  check (product_id <> analog_id)
);
create index if not exists shop_product_analogs_reverse on shop_product_analogs(analog_id);
alter table shop_orders add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table shop_orders add column if not exists vehicle_snapshot jsonb;
create index if not exists shop_orders_vehicle_history on shop_orders(client_id, vehicle_id, created_at desc);
