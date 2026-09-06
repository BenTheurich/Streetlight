CREATE TABLE pilot_request_rate_limits (
  client_hash TEXT PRIMARY KEY,
  window_ends_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 5)
) STRICT;

CREATE INDEX pilot_request_rate_limits_expiry ON pilot_request_rate_limits (window_ends_at);
