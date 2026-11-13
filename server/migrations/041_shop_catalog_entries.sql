-- Reference catalog for heavy trucks and trailers. No fabricated price or stock.
-- Imported entries are quarantined until separately reviewed by an administrator.
-- This migration does NOT alter shop.enabled or its closed storefront text.
create table if not exists shop_catalog_entries (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  article text not null,
  brand_key text not null,
  article_key text not null,
  name text not null,
  category text not null,
  search_terms text,
  source_note text not null,
  reviewed boolean not null default false,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_key, article_key),
  check (length(trim(name)) between 2 and 120),
  check (length(trim(brand)) between 1 and 80),
  check (length(trim(article)) between 2 and 100)
);
create index if not exists shop_catalog_entries_reviewed_category
  on shop_catalog_entries(reviewed, category, name);
create index if not exists shop_catalog_entries_updated
  on shop_catalog_entries(updated_at desc, id);
