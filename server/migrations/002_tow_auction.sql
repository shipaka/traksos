-- Торги эвакуатора: эвакуаторщики рядом предлагают цену в коридоре, клиент выбирает.

alter table order_dispatch drop constraint order_dispatch_status_check;
alter table order_dispatch add constraint order_dispatch_status_check
  check (status in ('queued','ringing','accepted','declined','missed','cancelled','bidding','lost'));

alter table orders add column destination text;         -- куда везти
alter table orders add column cargo text;               -- tractor, semitrailer, coupling, truck12
alter table orders add column loaded text;              -- empty, loaded, adr
alter table orders add column driver_on_site boolean;   -- водитель и ключи на месте
alter table orders add column auction_until timestamptz;

create table tow_bids (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  performer_id  uuid not null references users(id),
  price         integer not null,         -- копейки, за перевозку
  eta_minutes   integer not null,         -- подача: сборы + дорога
  status        text not null default 'active' check (status in ('active','chosen','lost','withdrawn')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, performer_id)
);
create index tow_bids_order on tow_bids(order_id, status);
