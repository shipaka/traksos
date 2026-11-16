-- Route evidence is scoped to one active order; never retain general off-duty movement.
-- Raw samples are not automatically evidence for billable route milestones.
CREATE TABLE IF NOT EXISTS performer_route_samples (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  performer_id uuid NOT NULL REFERENCES users(id),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  received_at timestamptz NOT NULL DEFAULT now(),
  accepted boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS performer_route_samples_order_recent
  ON performer_route_samples(order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS performer_route_samples_performer_recent
  ON performer_route_samples(performer_id, received_at DESC);
