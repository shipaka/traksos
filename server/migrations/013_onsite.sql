-- Мастер на заявке: опоздание, отметки на месте, проверка подсказки с консультации,
-- уточнение карточки машины, «не брать заявки этого клиента»
alter table orders add column if not exists site_flags text[] not null default '{}';
alter table orders add column if not exists late_minutes int not null default 0;
alter table orders add column if not exists hint_check text check (hint_check in ('yes','part','no'));
alter table vehicles add column if not exists axles int check (axles between 2 and 5);
alter table vehicles add column if not exists fixed_by uuid references users(id);
alter table vehicles add column if not exists fixed_at timestamptz;
create table if not exists performer_blocks (
  performer_id uuid not null references users(id) on delete cascade,
  client_id    uuid not null references users(id) on delete cascade,
  reason       text,
  created_at   timestamptz not null default now(),
  primary key (performer_id, client_id)
);
