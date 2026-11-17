-- Separate community domain: never mix public/closed messages with an order's private chat.
create table if not exists community_profiles (
 user_id uuid primary key references users(id) on delete cascade,
 nickname text not null,
 city_label text,
 share_city boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint community_nickname_length check (char_length(nickname) between 3 and 24)
);
create unique index if not exists community_profiles_nickname_ci on community_profiles(lower(nickname));

create table if not exists community_rooms (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 title text not null,
 kind text not null check (kind in ('general','regional','city','route','technical','professional')),
 audience text not null check (audience in ('all','driver','professional')),
 specialty text,
 locality_label text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists community_memberships (
 room_id uuid not null references community_rooms(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(room_id,user_id)
);
create index if not exists community_memberships_user on community_memberships(user_id);

create table if not exists community_messages (
 id bigint generated always as identity primary key,
 room_id uuid not null references community_rooms(id) on delete cascade,
 sender_id uuid not null references users(id) on delete cascade,
 body text not null check (char_length(body) between 1 and 2000),
 client_nonce uuid not null,
 moderation_state text not null default 'published' check (moderation_state in ('published','pending','hidden')),
 created_at timestamptz not null default now(),
 unique(sender_id,client_nonce)
);
create index if not exists community_messages_room_cursor on community_messages(room_id,id) where moderation_state='published';
create index if not exists community_messages_sender_rate on community_messages(sender_id,created_at desc);

create table if not exists community_reports (
 id bigint generated always as identity primary key,
 message_id bigint not null references community_messages(id) on delete cascade,
 reporter_id uuid not null references users(id) on delete cascade,
 reason text not null check (char_length(reason) between 3 and 240),
 status text not null default 'open' check (status in ('open','reviewed')),
 created_at timestamptz not null default now(),
 unique(message_id,reporter_id)
);

create index if not exists community_reports_reporter on community_reports(reporter_id);

create table if not exists community_knowledge (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references users(id),
 title text not null,
 make text not null,
 model text,
 model_year integer check (model_year between 1985 and 2026),
 subsystem text not null,
 description text not null,
 source_url text,
 rights_basis text not null check (rights_basis in ('own','permission','open_license','unknown')),
 rights_reference text,
 rights_review text not null default 'pending' check (rights_review in ('pending','approved','rejected')),
 technical_review text not null default 'pending' check (technical_review in ('pending','approved','rejected')),
 rights_reviewer uuid references users(id),
 technical_reviewer uuid references users(id),
 technical_review_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists community_knowledge_author on community_knowledge(author_id);
create index if not exists community_knowledge_rights_reviewer on community_knowledge(rights_reviewer) where rights_reviewer is not null;
create index if not exists community_knowledge_technical_reviewer on community_knowledge(technical_reviewer) where technical_reviewer is not null;
create index if not exists community_knowledge_search on community_knowledge(lower(make),lower(subsystem),model_year) where rights_review='approved' and technical_review='approved';

-- Only real initial nationwide rooms; do NOT advertise hundreds of empty cities or routes.
insert into community_rooms(slug,title,kind,audience,specialty) values
 ('drivers-russia','Водительский Эфир · Россия','general','driver',null),
 ('vehicle-help','Вопросы по технике','technical','all',null),
 ('electric-pro','Профклуб электриков','professional','professional','electric')
on conflict (slug) do nothing;
