create table if not exists support_linked_requests (
  user_id uuid not null references users(id) on delete cascade,
  request_key uuid not null,
  request_hash text not null,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,request_key)
);
