-- Agent case cash reversals: trace every negative correction to ONE original payment.
-- Isolated internal evidence; does not initiate bank refunds.
alter table shop_agency_events
  add column reverses_event_id uuid references shop_agency_events(id) on delete restrict;
alter table shop_agency_events
  add column correction_reason text;
alter table shop_agency_events
  add constraint shop_agency_cash_reversal_link check (
    (kind in ('customer_receipt_reversal','supplier_payment_reversal')
       and reverses_event_id is not null
       and length(btrim(coalesce(correction_reason,''))) between 8 and 1000)
    or
    (kind not in ('customer_receipt_reversal','supplier_payment_reversal')
       and reverses_event_id is null and correction_reason is null)
  );
create index if not exists shop_agency_cash_reversals_source
  on shop_agency_events(reverses_event_id) where reverses_event_id is not null;
