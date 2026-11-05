-- Машину можно удалить из гаража, даже если по ней были заявки: заявки остаются, ссылка обнуляется
alter table orders drop constraint if exists orders_vehicle_id_fkey;
alter table orders add constraint orders_vehicle_id_fkey foreign key (vehicle_id) references vehicles(id) on delete set null;
create index if not exists orders_vehicle on orders(vehicle_id, created_at desc) where vehicle_id is not null;
