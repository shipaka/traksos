-- Sponsored partner announcements are separate from driver chats and private messages.
-- Everything is pending moderation; no paid placement or automatic publication.
create table if not exists community_partner_offers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references users(id),
  category text not null check (category in ('master','tow','service','insurer')),
  display_name varchar(80) not null,
  title varchar(90) not null,
  description varchar(700) not null,
  region_label varchar(80) not null,
  status text not null default 'pending'
    check (status in ('pending','published','rejected','hidden')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references users(id),
  moderation_note varchar(500),
  constraint community_offer_published_valid check (
    status <> 'published' or (published_at is not null and expires_at is not null)
  )
);
create index if not exists community_partner_offers_active
  on community_partner_offers(expires_at desc, published_at desc)
  where status='published';
create index if not exists community_partner_offers_partner
  on community_partner_offers(partner_id,created_at desc);
create index if not exists community_partner_offers_review
  on community_partner_offers(created_at desc)
  where status='pending';
