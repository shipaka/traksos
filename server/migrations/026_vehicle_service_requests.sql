-- Applications for partner-managed insurance and technical inspections.
-- No policy issuance or official inspection certificate is performed by TrakSOS.
create table if not exists vehicle_service_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  requested_by uuid not null references users(id),
  vehicle_id uuid not null references vehicles(id),
  kind text not null check (kind in ('insurance', 'inspection')),
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'need_documents', 'sent_to_partner', 'completed', 'rejected', 'cancelled')),
  comment text,
  staff_note text,
  assigned_to uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_service_requests_owner_idx on vehicle_service_requests(owner_id, created_at desc);
create index if not exists vehicle_service_requests_queue_idx on vehicle_service_requests(kind, status, created_at);
