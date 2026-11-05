-- «Нужна запчасть»: мастер ждёт (оплачивается ожидание), уедет и вернётся, эвакуатор
alter table orders add column if not exists part_mode text check (part_mode in ('wait','return','tow'));
alter table orders add column if not exists wait_started_at timestamptz;
alter table orders add column if not exists wait_minutes int not null default 0;
