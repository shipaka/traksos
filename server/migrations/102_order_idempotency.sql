-- Stable client intent prevents a network timeout creating two SOS cases.
-- API callers supply Idempotency-Key; same caller/key/payload returns the
-- first order, while changed payloads must explicitly use a NEW key.
alter table orders add column create_request_key text;
alter table orders add column create_request_hash text;
alter table orders add constraint orders_create_request_key_valid
  check (create_request_key is null or
    (char_length(create_request_key) between 8 and 100
     and create_request_key ~ '^[A-Za-z0-9._:-]+$'));
alter table orders add constraint orders_create_request_pair
  check ((create_request_key is null and create_request_hash is null)
      or (create_request_key is not null and create_request_hash is not null));
create unique index orders_create_key_unique
 on orders(created_by, create_request_key)
 where create_request_key is not null;
