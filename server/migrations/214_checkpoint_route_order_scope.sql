-- КПП: block cross-order consent reuse even when plan/performer/grant match.
-- Complement migration 213 (which relates the same 3 IDs without order_id).
-- No data rewritten; the new FK protects all new records immediately.
alter table checkpoint_gps_consent_events
  add constraint checkpoint_consent_seq_plan_order_performer_uq
  unique (seq,plan_id,order_id,performer_id);

alter table performer_route_samples
  add constraint checkpoint_route_consent_order_scope_fk
  foreign key (checkpoint_consent_seq,checkpoint_plan_id,order_id,performer_id)
  references checkpoint_gps_consent_events(seq,plan_id,order_id,performer_id)
  not valid;

-- Legacy/staging consented rows are NOT silently validated or repaired.
-- An admin-only, explicit audit compares these links before VALIDATE.
