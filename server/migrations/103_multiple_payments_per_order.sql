-- One SOS order legitimately has both a call-out hold and a work payment.
-- Preserve uniqueness per payment and per provider idempotency key; never
-- restrict the number of separate payment intents per order.
alter table payment_create_intents
  drop constraint if exists payment_create_intents_order_id_key;
create index if not exists payment_create_intents_order_lookup
  on payment_create_intents(order_id, created_at);
