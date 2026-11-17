-- Informational workshop service deadline, never an automatic SOS cancellation.
alter table orders
  add column if not exists ecu_due_at timestamptz,
  add column if not exists ecu_extensions_count integer not null default 0
    check (ecu_extensions_count >= 0);
create index if not exists orders_ecu_due_active_idx on orders(ecu_due_at)
  where service='ecu' and status not in ('completed','cancelled','no_performer');
