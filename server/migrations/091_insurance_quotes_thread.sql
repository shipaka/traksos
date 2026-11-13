-- Insurance proposals and secure partner/client thread.
-- Existing inspection requests and legacy insurance requests remain supported.
alter table vehicle_service_requests
  add column if not exists insurance_details jsonb,
  add column if not exists insurance_stage text,
  add column if not exists insurance_choice_id uuid;
alter table vehicle_service_requests
  add constraint insurance_stage_check
  check (insurance_stage is null or insurance_stage in
    ('received','preparing','offers_sent','selected','processing','policy_sent'));
create table if not exists insurance_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references vehicle_service_requests(id) on delete cascade,
  company text not null,
  product text not null,
  premium_kopecks integer not null check (premium_kopecks > 0),
  description text not null default '',
  coverage text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists insurance_proposals_request_idx on insurance_proposals(request_id,created_at);
alter table vehicle_service_requests
  add constraint insurance_choice_fk foreign key (insurance_choice_id)
    references insurance_proposals(id);
create table if not exists insurance_thread_messages (
  id bigserial primary key,
  request_id uuid not null references vehicle_service_requests(id) on delete cascade,
  sender_id uuid references users(id),
  kind text not null check (kind in ('message','status','offers','selection','policy')),
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists insurance_thread_request_idx on insurance_thread_messages(request_id,id);
-- Encrypted PDF blob. The AES-GCM key never enters this table or API response.
create table if not exists insurance_policy_files (
  request_id uuid primary key references vehicle_service_requests(id) on delete cascade,
  mime text not null default 'application/pdf',
  file_name text not null,
  iv bytea not null,
  tag bytea not null,
  data bytea not null,
  uploaded_at timestamptz not null default now()
);
