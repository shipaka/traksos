-- Separate customer-approved stationary diagnostic offer from any later repair work.
-- No SMS, bank holds or automatic payments are triggered by this column.
alter table bids
  add column if not exists ecu_diagnostic_scope text;
alter table bids
  add constraint bids_ecu_diagnostic_scope_length
  check (ecu_diagnostic_scope is null or char_length(ecu_diagnostic_scope) between 10 and 500);
