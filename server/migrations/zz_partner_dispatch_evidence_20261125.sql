-- Prospective evidence of server-side dispatch invitations, not delivery/read receipts.
-- No backfill: order_dispatch.sent_at is mutable and rows can be deleted on retry.
-- This table is not exposed to clients and does not change dispatch decisions.
create table partner_dispatch_evidence_coverage (
  singleton boolean primary key default true check(singleton),
  capture_started_at timestamptz not null default clock_timestamp()
);
insert into partner_dispatch_evidence_coverage(singleton) values(true);

create table partner_dispatch_evidence (
  order_id uuid not null references orders(id) on delete cascade,
  performer_id uuid not null references users(id) on delete cascade,
  first_observed_sent_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(order_id, performer_id)
);
create index partner_dispatch_evidence_performer_time
  on partner_dispatch_evidence(performer_id,first_observed_sent_at,order_id);

create function record_partner_dispatch_evidence() returns trigger language plpgsql as $$
begin
  -- A queued/cancelled row or a status-only edit is not a new invitation.
  if new.sent_at is null or new.status not in ('ringing','bidding') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.sent_at is not distinct from new.sent_at then
      return new;
    end if;
  end if;
  insert into partner_dispatch_evidence(order_id,performer_id,first_observed_sent_at)
    values(new.order_id,new.performer_id,new.sent_at)
    on conflict(order_id,performer_id) do nothing;
  return new;
end;
$$;
create trigger partner_dispatch_evidence_capture
  after insert or update of sent_at on order_dispatch
  for each row execute function record_partner_dispatch_evidence();
