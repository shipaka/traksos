-- ТракSOS: первая схема. Деньги везде в копейках (integer).

create extension if not exists pgcrypto;

-- Люди и вход ---------------------------------------------------------------

create table users (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null unique,               -- +7XXXXXXXXXX
  name          text,
  roles         text[] not null default '{client}', -- client, driver, master, tow, service, moderator, admin
  status        text not null default 'active' check (status in ('active','blocked')),
  owner_id      uuid references users(id),          -- водитель привязан к владельцу
  company_name  text,
  company_inn   text,
  edo_operator  text,
  edo_id        text,
  rating        numeric(3,2),                        -- взвешенный рейтинг, null пока нет отзывов
  rating_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table auth_codes (
  phone       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  sent_at     timestamptz not null default now()
);

create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  device      text
);
create index sessions_user on sessions(user_id);

create table push_tokens (
  user_id     uuid not null references users(id) on delete cascade,
  provider    text not null check (provider in ('rustore','web','log')),
  token       text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider, token)
);

-- Машины ---------------------------------------------------------------------

create table vehicles (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users(id) on delete cascade,
  driver_id      uuid references users(id),
  brand          text not null,
  model          text,
  year           integer,
  plate          text,
  trailer_plate  text,
  qr_code        text unique default encode(gen_random_bytes(9), 'hex'),
  created_at     timestamptz not null default now()
);
create index vehicles_owner on vehicles(owner_id);

-- Исполнители ----------------------------------------------------------------

create table performer_profiles (
  user_id          uuid primary key references users(id) on delete cascade,
  kind             text not null check (kind in ('master','tow','service','ecu')),
  specialties      text[] not null default '{electric}',  -- electric, diag, air, autonomy, tyre, consult
  brands           jsonb not null default '{}',            -- {"Scania":"excellent","DAF":"good","MAN":"refuse"}
  tier             text not null default 'eco' check (tier in ('eco','comfort','pro')),
  call_out_price   integer,             -- копейки; null = цена уровня из настроек
  hour_price       integer,
  km_rate          integer,             -- копейки за км за КАД
  prep_minutes     integer not null default 0,
  is_priority      boolean not null default false,  -- «вы с отцом»: первыми в очереди
  paused           boolean not null default false,
  line_status      text not null default 'offline'
                   check (line_status in ('online','on_call','on_job','busy','offline')),
  busy_until       timestamptz,
  lat              double precision,
  lng              double precision,
  location_at      timestamptz,
  missed_in_row    integer not null default 0,
  verification     text not null default 'pending' check (verification in ('pending','approved','rejected')),
  tax_status       text check (tax_status in ('self_employed','ip')),
  inn              text,
  accepts_group    boolean not null default true,
  car              jsonb,                -- {"brand":"Lada Largus","color":"белый","plate":"..."}
  updated_at       timestamptz not null default now()
);
create index performer_line on performer_profiles(kind, line_status);

-- Настройки площадки (цены, комиссии, переключатели) --------------------------

create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id)
);

-- Заявки ---------------------------------------------------------------------

create sequence order_number_seq start 1001;

create table orders (
  id               uuid primary key default gen_random_uuid(),
  number           integer not null unique default nextval('order_number_seq'),
  client_id        uuid not null references users(id),   -- владелец (плательщик)
  created_by       uuid not null references users(id),   -- кто нажал (владелец или водитель)
  vehicle_id       uuid references vehicles(id),
  service          text not null,       -- electric, diag, air, autonomy, tyre, tow, consult
  is_sos           boolean not null default false,
  problem          text,                -- категория SOS: no_start, light, error, heater, wheel, accident, air, other
  description      text,
  address          text,
  lat              double precision,
  lng              double precision,
  zone_id          text not null default 'spb',
  night            boolean not null default false,
  group_trip       boolean not null default false,
  tier             text not null default 'eco',
  brand            text,
  status           text not null default 'searching' check (status in
                   ('searching','accepted','en_route','arrived','working','awaiting_confirmation',
                    'completed','cancelled','no_performer')),
  performer_id     uuid references users(id),
  estimate         jsonb,               -- расчёт цены при создании
  call_out_amount  integer,             -- выезд, копейки (зафиксирован при принятии)
  work_amount      integer,             -- работа, предложенная мастером
  amount_proposed_at       timestamptz,
  amount_confirmed_at      timestamptz,
  payment_method   text not null default 'cash' check (payment_method in ('cash','online','invoice')),
  client_fee_pct   numeric(5,2) not null default 0,  -- сбор с клиента, зафиксированный при создании
  dispatch_started_at timestamptz,                   -- при онлайн-оплате — после заморозки выезда
  result           text check (result in ('solved','cause_found','not_found')),
  result_note      text,
  cancel_reason    text,
  cancelled_by     uuid references users(id),
  cancel_stage     text,
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  en_route_at      timestamptz,
  arrived_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz
);
create index orders_client on orders(client_id, created_at desc);
create index orders_performer on orders(performer_id, created_at desc);
create index orders_status on orders(status);

-- Очередь вызова: кому и когда «звонили»
create table order_dispatch (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  performer_id  uuid not null references users(id),
  rank          integer not null,
  status        text not null default 'queued'
                check (status in ('queued','ringing','accepted','declined','missed','cancelled')),
  ring_until    timestamptz,
  sent_at       timestamptz,
  responded_at  timestamptz,
  distance_km   double precision,
  unique (order_id, performer_id)
);
create index dispatch_ringing on order_dispatch(status, ring_until);

-- Лента событий задачи
create table order_events (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  actor_id    uuid references users(id),
  type        text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index order_events_order on order_events(order_id, id);

-- Чат ------------------------------------------------------------------------

create table chat_messages (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  sender_id   uuid references users(id),       -- null = система
  kind        text not null default 'text' check (kind in ('text','quick','system')),
  body        text not null,
  masked      boolean not null default false,  -- номер телефона скрыт
  flagged     boolean not null default false,  -- «напрямую», «мимо» → модератору
  created_at  timestamptz not null default now()
);
create index chat_order on chat_messages(order_id, id);

-- Отзывы ---------------------------------------------------------------------

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  author_id   uuid not null references users(id),
  target_id   uuid not null references users(id),
  stars       integer not null check (stars between 1 and 5),
  tags        text[] not null default '{}',
  text        text,
  weight      numeric(4,3) not null,
  disputed    boolean not null default false,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (order_id, author_id)
);
create index reviews_target on reviews(target_id);

-- Оплата по агентской схеме (включается переключателем) -----------------------

create table payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id),
  kind                 text not null check (kind in ('call_out','work','consult')),
  method               text not null check (method in ('sbp','card','invoice')),
  amount               integer not null,      -- сумма исполнителю (принципалу), копейки
  client_fee           integer not null,      -- сервисный сбор с клиента
  total                integer not null,      -- amount + client_fee, списывается с клиента
  status               text not null default 'created' check (status in
                       ('created','pending','held','captured','refunded','partially_refunded','cancelled','failed')),
  provider             text not null,
  provider_payment_id  text,
  confirmation_url     text,
  idempotency_key      text not null unique,
  refunded_amount      integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index payments_order on payments(order_id);

create table payouts (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id),
  performer_id        uuid not null references users(id),
  amount              integer not null,         -- к выплате мастеру
  commission          integer not null,         -- удержанное вознаграждение агента
  status              text not null default 'pending' check (status in ('pending','processing','paid','failed')),
  provider            text not null,
  provider_payout_id  text,
  receipt_status      text not null default 'pending' check (receipt_status in ('pending','issued','not_required','failed')),
  receipt_ref         text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index payouts_performer on payouts(performer_id, created_at);

-- Учёт по счетам: client, performer, platform, provider. Сумма проводок по заявке = 0.
create table ledger_entries (
  id           bigserial primary key,
  order_id     uuid references orders(id),
  payment_id   uuid references payments(id),
  account      text not null,        -- 'client', 'platform', 'provider_fee', 'performer'
  performer_id uuid references users(id),
  amount       integer not null,     -- копейки, +/-
  kind         text not null,        -- payment, fee, commission, payout, refund, cash_commission, cash_commission_paid
  note         text,
  created_at   timestamptz not null default now()
);
create index ledger_performer on ledger_entries(performer_id, created_at);
create index ledger_order on ledger_entries(order_id);

create table agent_reports (
  id            uuid primary key default gen_random_uuid(),
  performer_id  uuid not null references users(id),
  period        text not null,       -- '2026-12'
  totals        jsonb not null,
  created_at    timestamptz not null default now(),
  unique (performer_id, period)
);

-- Оферты и согласия (152-ФЗ, 289-ФЗ) ------------------------------------------

create table offers (
  id            uuid primary key default gen_random_uuid(),
  audience      text not null check (audience in ('client','performer','privacy')),
  version       text not null,
  url           text not null,
  summary       text,
  published_at  timestamptz not null default now(),
  effective_at  timestamptz not null,   -- для исполнителей — не раньше чем через 15 дней
  unique (audience, version)
);

create table consents (
  user_id      uuid not null references users(id) on delete cascade,
  offer_id     uuid not null references offers(id),
  accepted_at  timestamptz not null default now(),
  ip           text,
  primary key (user_id, offer_id)
);

create table notifications (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null,
  body        text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user on notifications(user_id, id desc);

-- Журнал действий модераторов и админов
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references users(id),
  action      text not null,
  target      text,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
