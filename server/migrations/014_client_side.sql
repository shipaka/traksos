-- Клиент: условия на месте (тип места, пропуск, кто встретит, что с машиной, когда), «мои мастера» — избранное и «не предлагать»
alter table orders add column if not exists site jsonb;
create table if not exists client_prefs (
  client_id    uuid not null references users(id) on delete cascade,
  performer_id uuid not null references users(id) on delete cascade,
  pref         text not null check (pref in ('fav','hide')),
  created_at   timestamptz not null default now(),
  primary key (client_id, performer_id)
);
alter table orders add column if not exists work_started_at timestamptz;
