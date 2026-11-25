-- The HTTP recorder already emits 'auth_sms_request_rejected' for SMS request
-- rate limits/provider refusals. Keep the on-disk category allowlist in sync.
-- Only request ID, method, route, status and non-sensitive error code are logged.
ALTER TABLE diagnostic_events DROP CONSTRAINT IF EXISTS diagnostic_events_category_check;
ALTER TABLE diagnostic_events ADD CONSTRAINT diagnostic_events_category_check
  CHECK (category IN ('http_server_error', 'auth_login_rejected', 'auth_sms_request_rejected'));
