-- Optional retry identity; existing messages and system messages remain unchanged.
alter table chat_messages add column if not exists client_request_id uuid;
alter table chat_messages add column if not exists client_request_fingerprint text;
create unique index if not exists chat_messages_client_request_unique
  on chat_messages(order_id,sender_id,client_request_id)
  where client_request_id is not null;
