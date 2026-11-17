-- Independent, provenance-preserving reference shelf. Distinct from reviewed
-- OEM instructions in community_knowledge. A diagram is illustrative only
-- until a qualified expert has approved applicability to a specific vehicle.
create table if not exists community_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (length(slug) between 4 and 100),
  title text not null,
  source_kind text not null check (source_kind in ('diagram','photo','document','manufacturer_portal')),
  coverage text not null check (coverage in ('generic','manufacturer')),
  make text,
  model text,
  subsystem text not null,
  description text not null,
  safety_note text not null,
  tags text[] not null default '{}',
  source_url text not null check (source_url ~ '^https://'),
  preview_url text check (preview_url is null or preview_url ~ '^https://commons.wikimedia.org/wiki/Special:FilePath/'),
  attribution_author text,
  license_code text not null,
  license_url text,
  rights_verified_on date,
  technical_status text not null default 'illustrative'
    check (technical_status in ('illustrative','portal_link','expert_approved','withdrawn')),
  active boolean not null default true,
  technical_reviewer uuid references users(id),
  technical_review_note text,
  technically_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_source_coverage check
    ((coverage='generic' and make is null) or (coverage='manufacturer' and make is not null)),
  constraint knowledge_source_portal check
    ((source_kind='manufacturer_portal' and coverage='manufacturer'
      and preview_url is null and license_code='LINK_ONLY'
      and technical_status in ('portal_link','withdrawn'))
      or (source_kind<>'manufacturer_portal' and coverage='generic'
        and license_code<>'LINK_ONLY' and technical_status<>'portal_link'))
);
create index if not exists knowledge_sources_filter
  on community_knowledge_sources(lower(subsystem),lower(make),source_kind)
  where active;
create index if not exists knowledge_sources_tags on community_knowledge_sources using gin(tags);
-- Avoid drifting into unsafe arbitrary attachment uploads. The source preview
-- is a Wikimedia Commons file redirect; no copyrighted OEM asset is mirrored.
