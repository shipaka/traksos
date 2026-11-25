-- #170: draft negotiation metadata. Legacy reservations remain readable but
-- must never be silently treated as two-party agreements.
ALTER TABLE performer_time_reservations
  ADD COLUMN IF NOT EXISTS agreement_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS requested_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS selected_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS selected_at timestamptz;

ALTER TABLE performer_time_reservations ADD CONSTRAINT performer_time_agreement_metadata
  CHECK (agreement_version>=0 AND (
    agreement_version=0 OR (
      requested_starts_at IS NOT NULL AND requested_ends_at IS NOT NULL
      AND requested_ends_at>requested_starts_at
      AND request_key IS NOT NULL
      AND (status NOT IN ('selected','confirmed','completed') OR
        (selected_by IS NOT NULL AND selected_by=performer_id AND selected_at IS NOT NULL))
      AND (status NOT IN ('confirmed','completed') OR
        (decided_by IS NOT NULL AND decided_by=client_id AND decision_at IS NOT NULL))
    )
  ));
