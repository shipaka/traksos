-- Free specialist-to-specialist technical handoff. ECU is a verified
-- STATIONARY service, not an outbound roadside performer or an insurance role.
create table if not exists ecu_stations (
  performer_id uuid primary key references performer_profiles(user_id) on delete cascade,
  public_name text not null, address text not null,
  approved_by uuid references users(id), approved_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists ecu_handoffs (
  id uuid primary key default gen_random_uuid(),
  root_order_id uuid not null references orders(id),
  source_order_id uuid not null references orders(id),
  client_id uuid not null references users(id),
  created_by uuid not null references users(id),
  summary text not null,
  state text not null default 'pending' check (state in ('pending','selected','closed')),
  selected_performer_id uuid references users(id),
  selected_quote_id uuid,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  unique(source_order_id)
);
create unique index if not exists ecu_one_active_handoff_per_case
  on ecu_handoffs(root_order_id) where state in ('pending','selected');
create index if not exists ecu_handoffs_client on ecu_handoffs(client_id,created_at desc);
create table if not exists ecu_quotes (
  id uuid primary key default gen_random_uuid(),
  handoff_id uuid not null references ecu_handoffs(id) on delete cascade,
  performer_id uuid not null references ecu_stations(performer_id),
  version integer not null default 1 check(version>=1),
  diagnosis_price integer not null check(diagnosis_price>0 and diagnosis_price<=100000000),
  explanation text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(handoff_id,performer_id)
);
alter table ecu_handoffs add constraint ecu_selected_quote_fk
  foreign key(selected_quote_id) references ecu_quotes(id);
create table if not exists ecu_handoff_notes (
  id bigint generated always as identity primary key,
  handoff_id uuid not null references ecu_handoffs(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,created_at timestamptz not null default now()
);
create index if not exists ecu_handoff_notes_history on ecu_handoff_notes(handoff_id,id);
