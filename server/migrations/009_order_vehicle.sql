-- Машина в заявке без гаража: модель и год (по желанию) — для подбора мастера и статистики спроса по маркам
alter table orders add column if not exists model text;
alter table orders add column if not exists year int check (year between 1950 and 2100);
