-- Stalled stage is a signal, not evidence of a violation.
create table if not exists order_sla_incidents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  stage text not null check (stage in ('searching','awaiting_owner','accepted','en_route','arrived','working','awaiting_confirmation')),
  stage_started_at timestamptz not null,
  due_at timestamptz not null,
  opened_at timestamptz not null default now(),
  performer_id uuid references users(id),
  review_state text not null default 'open' check (review_state in ('open','investigating','confirmed','excused')),
  review_note text not null default '',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  unique(order_id,stage,stage_started_at)
);
create index if not exists order_sla_queue_idx on order_sla_incidents(review_state,opened_at desc);
create index if not exists order_sla_repeat_idx on order_sla_incidents(performer_id,opened_at desc) where performer_id is not null;
