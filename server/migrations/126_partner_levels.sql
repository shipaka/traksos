-- Independent professional partner privileges, not pricing tiers or automatic dispatch ranking.
-- No automatic demotion; every level change requires an administrator's explained decision.
create table if not exists partner_presence_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  line_status text not null,
  paused boolean not null,
  observed_at timestamptz not null default clock_timestamp()
);
create index if not exists partner_presence_window
  on partner_presence_events(user_id,observed_at,id);

create or replace function partner_record_presence_event() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' or old.line_status is distinct from new.line_status
    or old.paused is distinct from new.paused then
    insert into partner_presence_events(user_id,line_status,paused)
      values(new.user_id,new.line_status,new.paused);
  end if;
  return new;
end;
$$;
drop trigger if exists partner_presence_change on performer_profiles;
create trigger partner_presence_change
  after insert or update of line_status,paused on performer_profiles
  for each row execute function partner_record_presence_event();
-- Existing workers start observation NOW; do not synthesize earlier online hours.
insert into partner_presence_events(user_id,line_status,paused)
select p.user_id,p.line_status,p.paused from performer_profiles p
where not exists(select 1 from partner_presence_events e where e.user_id=p.user_id);

create table if not exists partner_level_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  level text not null check(level in ('start','active','priority')),
  reason text not null check(char_length(reason) between 20 and 1200),
  decided_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  review_due_at timestamptz not null,
  current boolean not null default true,
  constraint partner_level_review_after_decision check(review_due_at>created_at)
);
create unique index if not exists partner_level_one_current
  on partner_level_decisions(user_id) where current;
create index if not exists partner_level_review_queue
  on partner_level_decisions(review_due_at) where current;

create table if not exists partner_level_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  message text not null check(char_length(message) between 20 and 1500),
  status text not null default 'open' check(status in ('open','resolved')),
  reviewer_id uuid references users(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists partner_level_one_open_appeal
 on partner_level_appeals(user_id) where status='open';
create index if not exists partner_level_appeal_queue
 on partner_level_appeals(created_at) where status='open';
