-- Public operator experience is NOT the professional repair knowledge library.
-- No copied OEM files, VIN, personal contacts, or service schematics are stored.
create table if not exists vehicle_owner_experiences(
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  vehicle_id uuid references vehicles(id) on delete set null,
  catalog_category text not null check(catalog_category in ('truck','trailer','van','bus','passenger')),
  catalog_brand_key text not null,
  catalog_model_key text not null,
  display_brand text not null,
  display_model text not null,
  model_year integer check(model_year is null or model_year between 1970 and 2100),
  topic text not null check(topic in ('operations','economy','daily-checks','ownership','road')),
  title text not null check(length(title) between 8 and 130),
  body text not null check(length(body) between 40 and 5000),
  client_nonce uuid not null,
  review_state text not null default 'pending' check(review_state in ('pending','published','hidden','rejected')),
  reviewed_by uuid references users(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(author_id,client_nonce)
);
create index if not exists vehicle_owner_experiences_public_idx
  on vehicle_owner_experiences(catalog_category,catalog_brand_key,catalog_model_key,created_at desc,id)
  where review_state='published' and deleted_at is null;
create index if not exists vehicle_owner_experiences_review_idx
  on vehicle_owner_experiences(review_state,created_at,id) where deleted_at is null;
create index if not exists vehicle_owner_experiences_author_idx
  on vehicle_owner_experiences(author_id,created_at desc,id);
create table if not exists vehicle_owner_experience_saves(
  experience_id uuid not null references vehicle_owner_experiences(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(experience_id,user_id)
);
create index if not exists vehicle_owner_experience_saves_user_idx
  on vehicle_owner_experience_saves(user_id,created_at desc);
create table if not exists vehicle_owner_experience_reports(
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references vehicle_owner_experiences(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text not null check(length(reason) between 15 and 500),
  review_state text not null default 'pending' check(review_state in ('pending','reviewed')),
  reviewed_by uuid references users(id),
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(experience_id,reporter_id)
);
create index if not exists vehicle_owner_experience_reports_queue_idx
  on vehicle_owner_experience_reports(review_state,created_at,id);
