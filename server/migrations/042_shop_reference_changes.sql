-- Incremental, customer-safe change feed for reviewed reference-only parts.
-- Never includes pricing, supplier procurement numbers, VINs or source/license notes.
create table if not exists shop_catalog_reference_changes (
  seq bigserial primary key,
  entry_id uuid not null,
  removed boolean not null,
  created_at timestamptz not null default now()
);

create or replace function track_shop_reference_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into shop_catalog_reference_changes(entry_id, removed) values (old.id, true);
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.reviewed then
      insert into shop_catalog_reference_changes(entry_id, removed) values (new.id, false);
    end if;
    return new;
  end if;
  if new.reviewed is not distinct from old.reviewed
     and new.brand is not distinct from old.brand
     and new.article is not distinct from old.article
     and new.name is not distinct from old.name
     and new.category is not distinct from old.category
     and new.search_terms is not distinct from old.search_terms then
    return new;
  end if;
  insert into shop_catalog_reference_changes(entry_id, removed)
    values (new.id, not new.reviewed);
  return new;
end;
$$;

drop trigger if exists shop_reference_change_trigger on shop_catalog_entries;
create trigger shop_reference_change_trigger
after insert or update or delete on shop_catalog_entries
for each row execute function track_shop_reference_change();

-- Initial snapshot of already reviewed entries comes from the paginated index;
-- subsequent updates/revocations use the new journal.
