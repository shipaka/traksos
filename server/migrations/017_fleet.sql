-- Мой парк: лимиты и права водителей, подтверждение владельцем заказов дороже лимита, документы только PDF
alter table users add column if not exists fleet jsonb not null default '{}';
alter table users add column if not exists edo_pdf_only boolean not null default false;
alter table vehicles add column if not exists driver_since timestamptz;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in
  ('awaiting_owner','searching','accepted','en_route','arrived','working','awaiting_confirmation','completed','cancelled','no_performer'));
alter table orders add column if not exists owner_note text;
