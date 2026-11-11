-- Immutable timeline of insurance and inspection request status/expiry changes.
create table if not exists vehicle_service_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references vehicle_service_requests(id) on delete cascade,
  status text not null,
  policy_expires_on date,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists vehicle_service_request_events_request_idx
  on vehicle_service_request_events(request_id, changed_at, id);

create or replace function record_vehicle_service_request_event()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.policy_expires_on is distinct from old.policy_expires_on then
    insert into vehicle_service_request_events(request_id, status, policy_expires_on, note, changed_at)
    values (new.id, new.status, new.policy_expires_on, new.staff_note, now());
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_service_request_event_trigger on vehicle_service_requests;
create trigger vehicle_service_request_event_trigger
after insert or update of status, policy_expires_on on vehicle_service_requests
for each row execute function record_vehicle_service_request_event();

-- Existing requests have only their latest state; do not invent past transitions.
insert into vehicle_service_request_events(request_id, status, policy_expires_on, note, changed_at)
select r.id, r.status, r.policy_expires_on, r.staff_note, r.updated_at
from vehicle_service_requests r
where not exists (
  select 1 from vehicle_service_request_events e where e.request_id=r.id
);
