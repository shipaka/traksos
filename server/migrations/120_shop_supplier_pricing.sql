-- TrackSOS parts merchandising: trading markup != 5% platform commission.
-- Percentages are basis points of verified procurement price, not percent of retail revenue.
create table if not exists shop_product_costing (
 product_id uuid primary key references shop_products(id) on delete cascade,
 supplier_name text not null default 'Автоконтинент',
 purchase_cost_kopecks bigint not null check (purchase_cost_kopecks>0),
 markup_bps integer not null default 3000 check (markup_bps between 0 and 30000),
 cost_source_note text not null check (char_length(cost_source_note) between 10 and 500),
 supplier_quote_ref text,
 exception_reason text,
 competitor_comparison text,
 competitor_eta_days integer check (competitor_eta_days between 0 and 90),
 cost_confirmed_at timestamptz not null default now(),
 reviewed_by uuid not null references users(id),
 updated_at timestamptz not null default now(),
 check (markup_bps>=3000 or
   (exception_reason is not null and char_length(exception_reason)>=20
    and competitor_comparison is not null and char_length(competitor_comparison)>=15)),
 check (purchase_cost_kopecks <= 1000000000000)
);
create index if not exists shop_product_costing_updated on shop_product_costing(updated_at desc);

-- A verified cost cannot be paired with a manually discounted retail price
-- below the explicitly approved markup (including a duly approved exception).
create or replace function shop_enforce_costing_price() returns trigger as $$
declare c record;
begin
 select purchase_cost_kopecks,markup_bps into c from shop_product_costing where product_id=new.id;
 if found and new.price::bigint < ((c.purchase_cost_kopecks * (10000::bigint + c.markup_bps) + 9999)/10000) then
   raise exception 'shop_price_below_verified_markup' using errcode='23514';
 end if;
 return new;
end;
$$ language plpgsql;
drop trigger if exists trg_shop_enforce_costing_price on shop_products;
create trigger trg_shop_enforce_costing_price
 before insert or update of price on shop_products
 for each row execute function shop_enforce_costing_price();

-- Status of supplier procurement is separate from the final client order.
-- Normalization is provisional until supplier's official status/API contract is known.
create table if not exists shop_supplier_order_events (
 id bigint generated always as identity primary key,
 shop_order_id uuid not null references shop_orders(id) on delete cascade,
 external_order_ref text,
 status text not null check (status in (
   'requested','accepted','processing','partner_accepted','awaiting_assembly',
   'assembling','assembled','dispatched','cancelled','unknown'
 )),
 raw_status text not null check (char_length(raw_status) between 1 and 200),
 event_time timestamptz not null,
 source text not null check (source in ('manual','autokontinent_api')),
 source_evidence text not null check (char_length(source_evidence) between 10 and 1000),
 cancellation_reason text,
 event_external_id text,
 recorded_by uuid references users(id) on delete set null,
 recorded_at timestamptz not null default now(),
 check (source='manual' or event_external_id is not null),
 check ((source='manual' and recorded_by is not null) or source='autokontinent_api')
);
create index if not exists shop_supplier_order_events_recent on shop_supplier_order_events(shop_order_id,event_time desc,id desc);
create unique index if not exists shop_supplier_event_once on shop_supplier_order_events(shop_order_id,source,event_external_id)
 where event_external_id is not null;

-- Reconciliation flags prevent a supplier cancellation silently completing a refund.
create table if not exists shop_supplier_order_issues (
 shop_order_id uuid primary key references shop_orders(id) on delete cascade,
 needs_review boolean not null default true,
 issue_kind text not null check (issue_kind in ('supplier_cancelled','status_conflict','availability_lost')),
 details text,
 resolved_at timestamptz,
 resolved_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now()
);

-- Cost snapshots are recorded at checkout, not inferred later from a changed
-- procurement price. Missing supplier cost stays UNKNOWN, never zero.
create table if not exists shop_order_cost_snapshots (
 shop_order_id uuid not null references shop_orders(id) on delete cascade,
 product_id uuid not null references shop_products(id),
 qty integer not null check (qty>0),
 purchase_unit_kopecks bigint not null check (purchase_unit_kopecks>0),
 retail_unit_kopecks bigint not null check (retail_unit_kopecks>=0),
 target_markup_bps integer not null,
 captured_at timestamptz not null default now(),
 primary key(shop_order_id,product_id)
);
create index if not exists shop_order_cost_snapshots_product on shop_order_cost_snapshots(product_id);
