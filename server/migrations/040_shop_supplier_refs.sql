-- Private procurement mapping. Never returned by public/customer catalog endpoints.
-- One preferred Autokontinent supplier article per TrackSOS product for now.
-- This table does NOT enable supplier API, prices, booking or storefront.
create table if not exists shop_supplier_refs (
  product_id uuid primary key references shop_products(id) on delete cascade,
  supplier text not null default 'autokontinent' check (supplier='autokontinent'),
  supplier_article text not null check (length(trim(supplier_article)) between 2 and 100),
  supplier_brand text,
  source_note text,
  verified boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists shop_supplier_refs_article on shop_supplier_refs(supplier, lower(supplier_article));
