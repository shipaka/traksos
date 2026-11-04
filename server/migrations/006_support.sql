-- Обращения в поддержку: по заявке («Позвать поддержку») или без неё. У каждого — своя переписка.

create table support_tickets (
  id          uuid primary key default gen_random_uuid(),
  number      serial unique,
  user_id     uuid not null references users(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  topic       text not null,
  status      text not null default 'open' check (status in ('open','closed')),
  assignee_id uuid references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references users(id)
);
create index support_open on support_tickets(status, updated_at desc);
create index support_user on support_tickets(user_id, created_at desc);

create table support_messages (
  id          bigserial primary key,
  ticket_id   uuid not null references support_tickets(id) on delete cascade,
  sender_id   uuid references users(id),
  from_staff  boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index support_messages_ticket on support_messages(ticket_id, id);
