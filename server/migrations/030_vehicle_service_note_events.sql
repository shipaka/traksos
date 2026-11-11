-- Capture edits to client-visible staff comments in the service request timeline.
-- Separate migration so already-applied 029 installations receive this change.
create or replace function record_vehicle_service_request_event()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into vehicle_service_request_events(request_id, status, policy_expires_on, note, changed_at)
    values (new.id, new.status, new.policy_expires_on, new.staff_note, now());
  elsif new.status is distinct from old.status
     or new.policy_expires_on is distinct from old.policy_expires_on
     or new.staff_note is distinct from old.staff_note then
    insert into vehicle_service_request_events(request_id, status, policy_expires_on, note, changed_at)
    values (new.id, new.status, new.policy_expires_on, new.staff_note, now());
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_service_request_event_trigger on vehicle_service_requests;
create trigger vehicle_service_request_event_trigger
after insert or update of status, policy_expires_on, staff_note on vehicle_service_requests
for each row execute function record_vehicle_service_request_event();
