-- PR #274: deterministic referral rewards and one deduction per underlying
-- order/booking. These are business-event identities, not per-request tokens.
-- Deliberately DO NOT erase historic points: an existing duplicate must stop
-- migration for a reviewed ledger reconciliation, not be silently deleted.

-- The invited customer receives a welcome credit once, even if registration
-- callbacks race or the client retries after a network failure.
create unique index if not exists points_welcome_once_20261124
  on points_entries(user_id)
  where kind='welcome';

-- A paid customer order generates at most one commission-share reward.
create unique index if not exists points_ref_client_order_once_20261124
  on points_entries(order_id)
  where kind='ref_client' and order_id is not null;

-- Each invited performer / workshop triggers a single milestone, including
-- when multiple completed orders or paid invoices settle simultaneously.
create unique index if not exists points_ref_performer_once_20261124
  on points_entries(ref_user_id)
  where kind='ref_performer' and ref_user_id is not null;
create unique index if not exists points_ref_service_once_20261124
  on points_entries(ref_user_id)
  where kind='ref_service' and ref_user_id is not null;

-- The owner and the performer can each redeem points on the same order,
-- but a retry of the same party's settlement must not spend twice.
create unique index if not exists points_spend_user_order_once_20261124
  on points_entries(user_id, order_id)
  where kind='spend' and order_id is not null;
create unique index if not exists points_spend_user_booking_once_20261124
  on points_entries(user_id, booking_id)
  where kind='spend' and booking_id is not null;
