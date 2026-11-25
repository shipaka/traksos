-- An immutable preliminary estimate for one exact negotiation revision.
-- Acknowledgment is not financial consent or confirmation of capacity.
CREATE TABLE planned_reservation_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES performer_time_reservations(id) ON DELETE RESTRICT,
  reservation_version integer NOT NULL CHECK(reservation_version>=1),
  owner_id uuid NOT NULL REFERENCES users(id),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX planned_reservation_estimates_lookup ON planned_reservation_estimates(reservation_id,reservation_version,owner_id);
