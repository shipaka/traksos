-- #170: preserve a confirmed span until BOTH sides agree to its replacement.
-- Pending move metadata is deliberately outside reserved_span and cannot reserve
-- additional capacity or release the original confirmed interval.
ALTER TABLE performer_time_reservations
  ADD COLUMN IF NOT EXISTS move_state text,
  ADD COLUMN IF NOT EXISTS move_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS move_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS move_actor_id uuid REFERENCES users(id);

ALTER TABLE performer_time_reservations ADD CONSTRAINT performer_time_move_metadata
CHECK (
  (move_state IS NULL AND move_starts_at IS NULL AND move_ends_at IS NULL AND move_actor_id IS NULL)
  OR (
    move_state IS NOT NULL AND move_state IN ('proposed','selected')
    AND status='confirmed' AND agreement_version>0
    AND move_starts_at IS NOT NULL AND move_ends_at IS NOT NULL
    AND move_ends_at>move_starts_at AND move_ends_at<=move_starts_at+interval '48 hours'
    AND move_actor_id IS NOT NULL
    AND ((move_state='proposed' AND move_actor_id=client_id)
      OR (move_state='selected' AND move_actor_id=performer_id))
  )
);
