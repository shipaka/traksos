-- Immutable catalog change feed for incremental, text-only offline indexes.
-- Does not change storefront enabled status or expose supplier prices.
create table if not exists shop_catalog_changes (
  seq bigserial primary key,
  product_id uuid not null,
  removed boolean not null,
  changed_at timestamptz not null default now()
);
create index if not exists shop_catalog_changes_product on shop_catalog_changes(product_id);

create or replace function track_shop_catalog_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into shop_catalog_changes(product_id, removed) values (old.id, true);
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.active is not distinct from old.active
     and new.name is not distinct from old.name
     and new.category is not distinct from old.category
     and new.brand is not distinct from old.brand
     and new.article is not distinct from old.article
     and new.search_terms is not distinct from old.search_terms then
    return new;
  end if;
  insert into shop_catalog_changes(product_id, removed)
  values (new.id, not new.active);
  return new;
end;
$$;

drop trigger if exists shop_catalog_change_trigger on shop_products;
create trigger shop_catalog_change_trigger
after insert or update or delete on shop_products
for each row execute function track_shop_catalog_change();

-- Existing product rows are handled by the initial paginated snapshot.
-- Future changes are deltas; price and stock changes are intentionally excluded.
