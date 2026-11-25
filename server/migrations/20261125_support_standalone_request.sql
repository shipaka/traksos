-- Standalone private support: retain request identity and routing preference.
alter table support_tickets
  add column if not exists client_request_key uuid,
  add column if not exists client_request_hash text,
  add column if not exists requested_staff_role text
    check (requested_staff_role in ('admin','moderator'));
create unique index if not exists support_tickets_user_request_key
  on support_tickets(user_id, client_request_key)
  where client_request_key is not null;
