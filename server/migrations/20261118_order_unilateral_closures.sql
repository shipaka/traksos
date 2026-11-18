-- One exceptional closure record per physical order. No automatic payment or acceptance.
create table if not exists order_unilateral_closures (
  order_id uuid primary key references orders(id) on delete restrict,
  performer_id uuid not null references users(id),
  request_key text not null,
  reason text not null check (reason in ('client_offline','client_unreachable','client_absent','other')),
  note text not null check (char_length(note) between 10 and 1500),
  work_amount integer not null check (work_amount>=0),
  quote_total integer not null check (quote_total>=0),
  quote_at timestamptz not null,
  status text not null default 'pending_client'
    check (status in ('pending_client','disputed','accepted')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references users(id),
  answer_reason text,
  check ((status='pending_client' and answered_at is null) or
         (status<>'pending_client' and answered_at is not null))
);
create index if not exists order_unilateral_closures_performer_idx
  on order_unilateral_closures(performer_id,created_at desc);
create index if not exists order_unilateral_closures_pending_idx
  on order_unilateral_closures(created_at)
  where status in ('pending_client','disputed');

-- Last line of defence against a concurrent quote edit after emergency submission.
-- This is intentionally independent of the browser's disabled button.
create or replace function traksos_guard_emergency_quote()
returns trigger language plpgsql as $$
begin
  if (new.work_amount is distinct from old.work_amount
      or new.bill is distinct from old.bill
      or new.amount_proposed_at is distinct from old.amount_proposed_at)
     and exists (
       select 1 from order_unilateral_closures uc
       where uc.order_id=old.id and uc.status in ('pending_client','disputed')
     )
  then
    raise exception 'Аварийная заявка находится на проверке: расчёт менять нельзя'
      using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists traksos_guard_emergency_quote_update on orders;
create trigger traksos_guard_emergency_quote_update
  before update on orders for each row execute function traksos_guard_emergency_quote();
