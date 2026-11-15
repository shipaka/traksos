-- A customer may cancel a SOS before the first bank-create request starts.
-- Such an intent MUST NOT ever be replayed by a worker after cancellation.
alter table payment_create_intents
  drop constraint if exists payment_create_intents_status_check;
alter table payment_create_intents
  add constraint payment_create_intents_status_check
  check (status in ('prepared','sending','needs_review','ready','abandoned'));
