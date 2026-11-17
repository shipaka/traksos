-- A route becomes a customer-facing assignment ONLY after the real
-- administrator approves warehouse evidence, supplier receipts and economics.
-- Keep the earlier "planned" event explicitly provisional.
alter table shop_delivery_events drop constraint if exists shop_delivery_events_status_check;
alter table shop_delivery_events add constraint shop_delivery_events_status_check
check (status in ('planned','assigned','accepted','collected','dispatched',
  'arrived','handoff_verified','delivered','failed','returned','route_cancelled'));

-- Query customer-visible confirmed assignments without scanning all events.
create index if not exists shop_delivery_events_assigned
 on shop_delivery_events(run_id,shop_order_id,id desc) where status='assigned';
