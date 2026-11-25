-- #170: hard safety boundary for future appointment reservations.
-- This migration does not invent availability or automatically reserve existing jobs.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS performer_time_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL REFERENCES users(id),
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  -- Every time is stored as an absolute instant. UI converts Europe/Moscow to UTC.
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reserved_span tstzrange GENERATED ALWAYS AS (tstzrange(starts_at,ends_at,'[)')) STORED,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','selected','confirmed','cancelled','completed')),
  -- Changing a confirmed slot requires another explicit agreement, not silent overwrite.
  decision_at timestamptz,
  decided_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  request_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at <= starts_at + interval '48 hours'),
  CHECK (status NOT IN ('confirmed','completed') OR (decided_by IS NOT NULL AND decision_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL),
  CHECK (cancellation_reason IS NULL OR length(trim(cancellation_reason)) >= 5)
);
-- PostgreSQL itself prevents a confirmed reservation being double-booked, including
-- two workers simultaneously confirming two different order proposals.
ALTER TABLE performer_time_reservations ADD CONSTRAINT performer_time_confirmed_no_overlap
  EXCLUDE USING gist (performer_id WITH =, reserved_span WITH &&)
  WHERE (status = 'confirmed') DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX IF NOT EXISTS performer_time_confirmed_order_once
  ON performer_time_reservations(order_id) WHERE status = 'confirmed' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS performer_time_request_key_once
  ON performer_time_reservations(client_id,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS performer_time_calendar_idx
  ON performer_time_reservations(performer_id,starts_at)
  WHERE status IN ('selected','confirmed');

CREATE TABLE IF NOT EXISTS performer_time_reservation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES performer_time_reservations(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  before_status text,
  after_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performer_time_events_by_reservation
  ON performer_time_reservation_events(reservation_id,created_at);
