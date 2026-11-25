-- #170: tentative time negotiation linked to a fleet-approved intent.
-- It is not a payable order. Until a later atomic checkout attaches a real
-- order, this path must not reserve capacity as confirmed.
ALTER TABLE planned_order_intents ADD CONSTRAINT planned_order_intents_owner_pair UNIQUE(id,owner_id);
ALTER TABLE performer_time_reservations ADD COLUMN planned_intent_id uuid;
ALTER TABLE performer_time_reservations ADD CONSTRAINT performer_time_planned_owner
  FOREIGN KEY(planned_intent_id,client_id) REFERENCES planned_order_intents(id,owner_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX performer_time_planned_intent_once
  ON performer_time_reservations(planned_intent_id) WHERE planned_intent_id IS NOT NULL;
ALTER TABLE performer_time_reservations ADD CONSTRAINT performer_time_planned_checkout
  CHECK(planned_intent_id IS NULL OR (agreement_version>0 AND
    (status NOT IN ('confirmed','completed') OR order_id IS NOT NULL)));
