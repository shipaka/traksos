-- One client incident can have several independently priced orders.
-- Root orders have case_root_id NULL. Continuations point to the original root.
-- Existing orders and consult_of discounts remain unchanged.
alter table orders
  add column if not exists case_root_id uuid references orders(id),
  add column if not exists continuation_of uuid references orders(id);

create index if not exists orders_case_root_idx on orders(case_root_id, created_at)
  where case_root_id is not null;
create unique index if not exists orders_one_live_continuation_idx
  on orders(continuation_of)
  where continuation_of is not null and status <> 'cancelled';
