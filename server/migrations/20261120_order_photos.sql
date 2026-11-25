-- Verified repair evidence: actual order photos, not synthetic design content.
-- Only authenticated participants may read; writes are checked again under
-- a locked order row in OrderPhotosService. No public image URLs.
create table if not exists order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  uploader_id uuid not null references users(id),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes between 1000 and 1400000),
  sha256 char(64) not null,
  iv bytea not null,
  tag bytea not null,
  ciphertext bytea not null,
  created_at timestamptz not null default now(),
  unique (order_id, uploader_id, sha256)
);
create index if not exists order_photos_order_created_idx
  on order_photos(order_id, created_at desc);
