-- Документы для проверки исполнителей. Фото хранятся зашифрованными (AES-256-GCM),
-- видят их только сам исполнитель и модератор; каждый просмотр модератором — в журнал.

create table documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null,              -- passport, selfie, car_front, car_side, equipment, tow_front, tow_side, sts
  mime          text not null,
  size          integer not null,
  sha256        text not null,              -- для поиска одинаковых фото в разных профилях
  iv            bytea not null,
  tag           bytea not null,
  data          bytea not null,             -- зашифровано
  taken_at      timestamptz,                -- когда снято (со слов телефона)
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  note          text,                       -- причина «переснять»
  reviewed_by   uuid references users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index documents_user on documents(user_id, kind);
create index documents_sha on documents(sha256);

alter table performer_profiles add column submitted_at timestamptz;   -- отправил на проверку
alter table performer_profiles add column verification_note text;      -- комментарий модератора
alter table performer_profiles add column verified_at timestamptz;
