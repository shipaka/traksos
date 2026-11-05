-- Очередь модератора: споры, обжалования, оспоренные отзывы; решения и журнал
create table if not exists mod_cases (
  id          uuid primary key default gen_random_uuid(),
  number      serial unique,
  kind        text not null check (kind in ('dispute','appeal','review')),
  status      text not null default 'open' check (status in ('open','resolved')),
  priority    int not null default 2,           -- 1 — срочно, 2 — обычно, 3 — не горит
  title       text not null,
  text        text,
  opened_by   uuid references users(id) on delete set null,
  target_id   uuid references users(id) on delete set null,
  order_id    uuid references orders(id) on delete set null,
  booking_id  uuid references service_bookings(id) on delete set null,
  review_id   uuid references reviews(id) on delete set null,
  ticket_id   uuid references support_tickets(id) on delete set null,
  decision    text,
  decision_note text,
  decided_by  uuid references users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists mod_cases_open on mod_cases(status, priority, created_at);
