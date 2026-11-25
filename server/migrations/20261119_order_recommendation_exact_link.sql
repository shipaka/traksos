-- A paid order must be linked to the exact owner-approved recommendation
-- that initiated its creation. Merely sharing an incident root is not proof.
-- Existing manually created/legacy stages remain unlinked.
alter table orders
 add column if not exists continuation_recommendation_id uuid
 references order_continuation_recommendations(id);

-- Browser retries and concurrent devices may not create two paid orders from
-- the same approved recommendation. A cancelled stage remains auditable.
create unique index if not exists orders_recommendation_once
 on orders(continuation_recommendation_id)
 where continuation_recommendation_id is not null;
