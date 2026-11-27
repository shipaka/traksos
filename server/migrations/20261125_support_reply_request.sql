alter table support_messages
  add column if not exists client_request_key uuid,
  add column if not exists client_request_hash text;
create unique index if not exists support_messages_actor_request_key
  on support_messages(ticket_id,sender_id,client_request_key)
  where client_request_key is not null;
