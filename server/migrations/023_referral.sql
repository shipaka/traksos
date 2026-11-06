-- Реферальные баллы: 1 балл = 1 ₽ скидки на сбор или комиссию ТракSOS, в деньги не выводятся.
alter table users add column if not exists ref_code text unique;
alter table users add column if not exists referred_by uuid references users(id);
alter table users add column if not exists referred_at timestamptz;

create table if not exists points_entries (
  id          bigserial primary key,
  user_id     uuid not null references users(id),
  amount      integer not null,            -- копейки: + начислено, − потрачено/сгорело
  kind        text not null check (kind in ('welcome','ref_client','ref_performer','ref_service','spend','expire','admin')),
  order_id    uuid references orders(id),
  booking_id  uuid,
  ref_user_id uuid references users(id),   -- за кого начислено
  note        text,
  expires_at  timestamptz,                 -- у начислений
  created_at  timestamptz not null default now()
);
create index if not exists points_user on points_entries(user_id, created_at);
-- Сколько баллами погашено сбора клиента и комиссии исполнителя по заявке
alter table orders add column if not exists points_fee integer not null default 0;
alter table orders add column if not exists points_commission integer not null default 0;
