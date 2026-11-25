-- Recommendation only: no financial, inventory or order state mutation.
create table if not exists part_recommendations (
 id uuid primary key default gen_random_uuid(),
 source_order_id uuid not null references orders(id),
 client_id uuid not null references users(id),
 suggested_by uuid not null references users(id),
 vehicle_id uuid references vehicles(id) on delete set null,
 tech_card_id text,
 product_id uuid references shop_products(id) on delete set null,
 brand text not null,
 article text not null,
 name text not null,
 qty int not null check(qty between 1 and 99),
 reason text not null,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by uuid references users(id)
);
create unique index if not exists part_recommendations_once on part_recommendations(source_order_id,lower(trim(brand)),lower(trim(article)));
create index if not exists part_recommendations_history on part_recommendations(client_id,vehicle_id,created_at desc);
comment on table part_recommendations is 'Non-billable repair advice. Acceptance is not an order or payment; checkout is separate.';

-- Only one explicit shop checkout for a single accepted recommendation.
alter table shop_orders add column if not exists part_recommendation_id uuid references part_recommendations(id);
create unique index if not exists shop_orders_part_recommendation_once on shop_orders(part_recommendation_id) where part_recommendation_id is not null;
