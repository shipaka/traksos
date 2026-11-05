-- Магазин: товары (добавляет админ вручную), заказы клиентов
create table if not exists shop_products (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'other',
  name        text not null,
  spec        text,
  description text,
  price       int not null check (price >= 0),          -- копейки
  stock       int,                                       -- null — под заказ; 0 — нет в наличии
  lead_days   int not null default 2,
  is_kit      boolean not null default false,            -- набор («Тревожный чемоданчик») — сверху
  active      boolean not null default true,
  sort        int not null default 100,
  photo_mime  text,
  photo       bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists shop_orders (
  id          uuid primary key default gen_random_uuid(),
  number      serial unique,
  client_id   uuid not null references users(id) on delete cascade,
  created_by  uuid not null references users(id) on delete cascade,
  status      text not null default 'new' check (status in ('new','confirmed','ready','shipped','done','cancelled')),
  items       jsonb not null,                            -- [{productId, name, price, qty, inStock}]
  goods_total int not null,
  delivery    text not null check (delivery in ('pickup','delivery','master')),
  delivery_price int not null default 0,
  total       int not null,
  address     text,
  order_id    uuid references orders(id) on delete set null,   -- «с мастером на заявке»
  payment     text not null default 'on_receipt' check (payment in ('on_receipt','invoice')),
  comment     text,
  admin_note  text,
  cancel_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists shop_orders_status on shop_orders(status, created_at);
