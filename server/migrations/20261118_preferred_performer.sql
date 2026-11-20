-- Targeted invitation to previously hired performer; no auto assignment.
alter table orders add column if not exists preferred_performer_id uuid references users(id);
create index if not exists orders_preferred_performer_idx on orders(preferred_performer_id,created_at desc)
  where preferred_performer_id is not null;
