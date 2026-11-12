-- Historical orders remain the source of truth for missed demand. Review notes are separate.
create table if not exists order_ops_reviews (
  order_id uuid primary key references orders(id) on delete cascade,
  state text not null default 'open' check (state in ('open','investigating','resolved')),
  note text not null default '',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz not null default now()
);

create table if not exists worker_announcements (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('master','tow','service','all_workers')),
  service text,
  title text not null check (char_length(title) between 3 and 140),
  body text not null check (char_length(body) between 3 and 3000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists worker_announcements_active on worker_announcements(published, starts_at, ends_at);

-- These rates apply to an order ONLY if the promotion is active when it is created.
-- Past orders and financial records must never be silently recalculated.
create table if not exists commission_campaigns (
  id uuid primary key default gen_random_uuid(),
  service text,
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  enabled boolean not null default false,
  reason text not null check (char_length(reason) between 3 and 500),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists commission_campaigns_active on commission_campaigns(enabled,starts_at,ends_at);
alter table orders add column if not exists commission_pct_override numeric(5,2);
alter table orders add column if not exists commission_campaign_id uuid references commission_campaigns(id);
create index if not exists order_ops_demand on orders(created_at, service, status);
