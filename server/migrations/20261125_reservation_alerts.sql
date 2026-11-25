-- #170: durable notification intents, separate from best-effort push.
CREATE TABLE performer_reservation_alerts (
  event_id bigint NOT NULL REFERENCES performer_time_reservation_events(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES performer_time_reservations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agreement_version integer NOT NULL CHECK(agreement_version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  outcome text CHECK(outcome IN ('stored','obsolete')),
  PRIMARY KEY(event_id,user_id),
  CHECK((handled_at IS NULL AND outcome IS NULL) OR (handled_at IS NOT NULL AND outcome IS NOT NULL))
);
CREATE INDEX performer_reservation_alerts_pending
  ON performer_reservation_alerts(created_at,event_id) WHERE handled_at IS NULL;
