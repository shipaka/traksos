-- Консультация по телефону: подсказка мастера и связь «консультация → выезд»
alter table orders add column if not exists consult_hint jsonb;
alter table orders add column if not exists consult_of uuid references orders(id);
alter table orders drop constraint if exists orders_result_check;
alter table orders add constraint orders_result_check check (result in ('solved','cause_found','not_found','consult'));
create index if not exists orders_consult_of on orders(consult_of) where consult_of is not null;
