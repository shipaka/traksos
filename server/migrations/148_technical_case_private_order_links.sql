-- Link a specialist's anonymous professional discussion to their own order
-- ONLY in the private database. This table is never selected by public club APIs.
-- Public discussion rows still contain no order ID, VIN, phone, address or GPS.
create table if not exists community_technical_case_order_links (
  case_id uuid primary key references community_technical_cases(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists community_case_private_order_author_idx
  on community_technical_case_order_links(order_id,author_id,created_at desc);
