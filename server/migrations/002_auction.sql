-- Торги для всех услуг: сначала заявка звонит приоритетным (вы с отцом), потом — общие торги.
-- Исполнители откликаются «по обычной цене» или своей (85–130% обычной), клиент выбирает.
-- SOS: через 90 секунд лучший из «Рекомендуем» назначается сам.

alter table order_dispatch drop constraint order_dispatch_status_check;
alter table order_dispatch add constraint order_dispatch_status_check
  check (status in ('queued','ringing','accepted','declined','missed','cancelled','bidding','lost'));

alter table orders add column auction_until timestamptz;   -- до когда принимаем отклики
alter table orders add column auto_pick boolean not null default false; -- SOS: назначить лучшего самим
-- Эвакуатор
alter table orders add column destination text;            -- куда везти
alter table orders add column cargo text;                  -- tractor, semitrailer, coupling, truck12
alter table orders add column loaded text;                 -- empty, loaded, adr
alter table orders add column driver_on_site boolean;      -- водитель и ключи на месте

create table bids (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  performer_id  uuid not null references users(id),
  price         integer not null,           -- выезд (для эвакуатора — перевозка), копейки
  hour_price    integer,                    -- час работы, копейки (null у эвакуатора)
  eta_minutes   integer not null,           -- подача: сборы + дорога
  status        text not null default 'active' check (status in ('active','chosen','lost','withdrawn')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, performer_id)
);
create index bids_order on bids(order_id, status);
