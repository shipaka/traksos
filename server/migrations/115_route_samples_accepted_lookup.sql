-- Support order-scoped accepted GPS history and cancellation audit lookups.
-- Rejected telemetry is never considered evidence.
CREATE INDEX IF NOT EXISTS performer_route_samples_accepted_order_performer_recent
  ON performer_route_samples(order_id, performer_id, received_at DESC)
  WHERE accepted = true;
