-- Invoice refunds must never be marked paid by an absent payment provider.
-- The administrator confirms an actual outgoing bank transfer separately.
alter table payment_refund_requests
  drop constraint if exists payment_refund_requests_status_check;
alter table payment_refund_requests
  add constraint payment_refund_requests_status_check
  check (status in ('processing','pending','needs_review','pending_manual_refund','succeeded','failed'));

alter table payment_refund_requests
  add column bank_transfer_reference text,
  add column bank_transferred_at timestamptz,
  add column bank_confirmed_by uuid references users(id),
  add column bank_confirmed_at timestamptz;

-- Migrate unresolved invoice attempts into the manual review queue. Never
-- backfill success without independent proof of money transfer.
update payment_refund_requests r
   set status='pending_manual_refund', updated_at=now()
  from payments p
 where r.payment_id=p.id and p.method='invoice'
   and r.status in ('processing','pending','needs_review');

drop index if exists payment_refund_requests_unresolved;
create index payment_refund_requests_unresolved on payment_refund_requests(payment_id)
 where status in ('processing','pending','needs_review','pending_manual_refund');

-- Prevent using one bank-payment receipt as proof for separate refunds.
create unique index payment_refund_requests_bank_transfer_unique
 on payment_refund_requests(bank_transfer_reference, bank_transferred_at)
 where bank_transfer_reference is not null;
