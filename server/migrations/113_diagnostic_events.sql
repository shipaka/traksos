-- Minimal diagnostic metadata only; never store credentials, request bodies or IP addresses.
CREATE TABLE IF NOT EXISTS diagnostic_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (category IN ('http_server_error', 'auth_login_rejected')),
  method text NOT NULL,
  path text NOT NULL,
  status integer NOT NULL,
  code text NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostic_events_recent ON diagnostic_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_events_request ON diagnostic_events(request_id);
