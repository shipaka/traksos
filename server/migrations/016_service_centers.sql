-- Рембаза (сервис-партнёр): карточка сервиса, запись клиента, машины в ремонте, агентский счёт
create table if not exists service_centers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null unique references users(id) on delete cascade,
  name         text not null,
  address      text not null,
  lat          double precision,
  lng          double precision,
  hours        text not null default '08:00–20:00',
  inn          text,
  brands       text[] not null default '{}',
  staff        jsonb not null default '{}',   -- {electric:'own'|'invite'|'none', ...}
  conditions   text[] not null default '{}',  -- parking, pit, lift, night
  accepts      text[] not null default '{quick,day}', -- quick, day, long
  closed_days  date[] not null default '{}',
  paused       boolean not null default false,
  verification text not null default 'pending' check (verification in ('pending','approved','rejected')),
  accepts_confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists service_bookings (
  id            uuid primary key default gen_random_uuid(),
  number        serial,
  center_id     uuid not null references service_centers(id) on delete cascade,
  client_id     uuid not null references users(id) on delete cascade,
  created_by    uuid not null references users(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete set null,
  vehicle       jsonb not null default '{}',  -- снимок: марка, модель, год, госномер
  need          text not null,                -- electric, air, engine, gearbox, brakes, chassis, tires, other
  when_day      date not null,
  when_time     text,
  arrival       text not null default 'self' check (arrival in ('self','tow')),
  comment       text,
  from_order_id uuid references orders(id) on delete set null,
  status        text not null default 'new' check (status in
                  ('new','clarify','declined','expected','arrived','diagnostics','in_work','waiting_part','agreeing','ready','invoiced','closed','disputed','cancelled')),
  clarify_q     text,
  client_answer text,
  decline_reason text,
  accept_time   text,
  notes         jsonb not null default '[]',  -- [{text, at, photoId?}]
  notes_public  boolean not null default false,
  works         text[] not null default '{}',
  amount        int,                           -- копейки, работы по счёту
  discount      int not null default 0,
  commission    int not null default 0,
  still_here_at timestamptz,
  arrived_at    timestamptz,
  ready_at      timestamptz,
  invoiced_at   timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists service_bookings_center on service_bookings(center_id, status);
create index if not exists service_bookings_vehicle on service_bookings(vehicle_id);
alter table service_bookings add column if not exists review_stars int check (review_stars between 1 and 5);
alter table service_bookings add column if not exists review_text text;
-- Мастер на месте: «причина найдена — советую сервис»
alter table orders add column if not exists recommended_center_id uuid references service_centers(id) on delete set null;
