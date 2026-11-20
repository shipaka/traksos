-- Public drivers' air is separate from private requests and order chats.
-- Messages are ephemeral social content, never a diagnostic or payment record.
create table if not exists driver_air_messages (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  author_label text not null,
  body text not null check (char_length(body) between 1 and 400),
  origin text not null check (origin in ('human','bot')),
  hidden_at timestamptz,
  hidden_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists driver_air_visible_idx on driver_air_messages (id desc) where hidden_at is null;
create index if not exists driver_air_user_rate_idx on driver_air_messages(user_id,created_at) where origin='human';
create table if not exists driver_air_state (
  id boolean primary key default true check(id=true),
  bot_enabled boolean not null default false,
  bot_last_at timestamptz,
  bot_day date,
  bot_today integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into driver_air_state(id) values(true) on conflict do nothing;
