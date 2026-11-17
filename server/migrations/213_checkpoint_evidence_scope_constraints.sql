-- КПП: defensive relational scoping at the database boundary.
-- The service layer already verifies order/performer/plan ownership; these
-- composite keys prevent accidental cross-order or cross-performer evidence
-- when an importer or future code path bypasses those checks.
--
-- NOT VALID does not rewrite or silently certify historical/staging rows.
-- PostgreSQL still enforces these foreign keys on all new inserts/updates.
-- Release gate: reconcile pre-existing mismatches before VALIDATE CONSTRAINT.
alter table checkpoint_evidence_plans
  add constraint checkpoint_plans_id_order_uq unique(id,order_id);
alter table checkpoint_evidence_plans
  add constraint checkpoint_plans_id_order_performer_uq unique(id,order_id,performer_id);
alter table checkpoint_gps_consent_events
  add constraint checkpoint_consent_seq_plan_performer_uq unique(seq,plan_id,performer_id);
alter table checkpoint_arrival_attempts
  add constraint checkpoint_attempt_id_order_uq unique(id,order_id);

alter table checkpoint_evidence_plans
  add constraint checkpoint_supersedes_same_order_fk
  foreign key (supersedes_id,order_id)
  references checkpoint_evidence_plans(id,order_id)
  not valid;

alter table checkpoint_gps_consent_events
  add constraint checkpoint_consent_scope_fk
  foreign key (plan_id,order_id,performer_id)
  references checkpoint_evidence_plans(id,order_id,performer_id)
  not valid;

alter table checkpoint_arrival_attempts
  add constraint checkpoint_attempt_scope_fk
  foreign key (plan_id,order_id,performer_id)
  references checkpoint_evidence_plans(id,order_id,performer_id)
  not valid;

alter table checkpoint_arrival_decisions
  add constraint checkpoint_decision_scope_fk
  foreign key (attempt_id,order_id)
  references checkpoint_arrival_attempts(id,order_id)
  not valid;

alter table performer_route_samples
  add constraint checkpoint_route_consent_scope_fk
  foreign key (checkpoint_consent_seq,checkpoint_plan_id,performer_id)
  references checkpoint_gps_consent_events(seq,plan_id,performer_id)
  not valid;

-- Strict fail-closed safeguards for NEW explicitly consented samples.
-- A route point with a consent reference is never "live" evidence unless
-- exactly the scoped plan and granted consent epoch match.
-- No state transition, billing flag or refund is introduced here.
