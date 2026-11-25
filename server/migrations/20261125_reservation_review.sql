-- #170: a passed confirmed interval is not proof of completion or cancellation.
-- Mark review once, preserve original decision and reservation history.
ALTER TABLE performer_time_reservations
  ADD COLUMN IF NOT EXISTS review_required_at timestamptz;
CREATE INDEX performer_time_pending_due_idx
  ON performer_time_reservations(starts_at,id)
  WHERE agreement_version>0 AND order_id IS NULL AND status IN ('proposed','selected');
CREATE INDEX performer_time_move_due_idx
  ON performer_time_reservations(move_starts_at,id)
  WHERE agreement_version>0 AND order_id IS NULL AND status='confirmed' AND move_state IS NOT NULL;
CREATE INDEX performer_time_review_due_idx
  ON performer_time_reservations(ends_at,id)
  WHERE agreement_version>0 AND order_id IS NULL AND status='confirmed' AND review_required_at IS NULL;
