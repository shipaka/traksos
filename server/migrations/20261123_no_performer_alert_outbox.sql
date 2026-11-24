-- Durable notification inbox recovery for exhausted SOS searches.
-- The terminal order event and these per-recipient intents are stored in the
-- same transaction. A temporary failure of the notifications table must not
-- erase an already confirmed no_performer result.
create table order_no_performer_alerts (
  event_id bigint not null references order_events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  outcome text check (outcome in ('stored','obsolete')),
  primary key (event_id, user_id),
  check ((handled_at is null and outcome is null) or
         (handled_at is not null and outcome is not null))
);
create index order_no_performer_alerts_pending
  on order_no_performer_alerts (created_at, event_id) where handled_at is null;
