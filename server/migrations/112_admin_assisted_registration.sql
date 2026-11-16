-- Internal administrative onboarding and developer-assistance requests.
-- No existing user is converted or silently granted a new role by this migration.
create table if not exists admin_developer_reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id),
  user_id uuid references users(id),
  phone text,
  category text not null check (category in ('registration', 'roles', 'login', 'cabinet', 'other')),
  details text not null,
  status text not null default 'queued' check (status in ('queued','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists admin_developer_reports_queue on admin_developer_reports(status, created_at desc);
