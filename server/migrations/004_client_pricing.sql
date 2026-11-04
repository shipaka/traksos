-- Цена для конкретного клиента: персональный сбор, скидка на заявку, бонусы.
-- Скидку и бонусы оплачивает площадка — исполнитель получает свою сумму полностью.

alter table users add column fee_pct_override numeric(5,2);   -- персональный сервисный сбор, null = общий
alter table orders add column discount_amount integer not null default 0;  -- скидка клиенту, копейки
alter table orders add column discount_reason text;

create table bonus_entries (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  amount      integer not null,           -- + начислено, − списано
  kind        text not null check (kind in ('grant','use','revoke')),
  order_id    uuid references orders(id),
  note        text,
  actor_id    uuid references users(id),
  created_at  timestamptz not null default now()
);
create index bonus_user on bonus_entries(user_id);
