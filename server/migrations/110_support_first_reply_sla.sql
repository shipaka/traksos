-- First meaningful human response SLA: 60 minutes.
-- Existing tickets are intentionally not backdated into the new alert queue.
alter table support_tickets add column sla_deadline_at timestamptz;
alter table support_tickets add column first_staff_reply_at timestamptz;
alter table support_tickets add column sla_overdue_at timestamptz;
alter table support_tickets alter column sla_deadline_at set default (now() + interval '60 minutes');

-- Historical first replies help reporting, but old tickets have no SLA deadline.
update support_tickets t
   set first_staff_reply_at=(
     select min(m.created_at) from support_messages m
      where m.ticket_id=t.id and m.from_staff=true
   );

create index support_sla_due on support_tickets(sla_deadline_at)
 where sla_deadline_at is not null and sla_overdue_at is null;

-- Durable evidence; the unique key protects retries and multiple workers.
create table support_sla_events (
  id bigserial primary key,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  kind text not null check (kind in ('first_reply_overdue')),
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(ticket_id,kind)
);
