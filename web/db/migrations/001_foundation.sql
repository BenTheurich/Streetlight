CREATE TABLE churches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE administrators (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (church_id, email)
) STRICT;

CREATE TABLE territories (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  center_latitude REAL NOT NULL,
  center_longitude REAL NOT NULL,
  radius_meters REAL NOT NULL CHECK (radius_meters > 0),
  boundary_geojson TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (church_id, name)
) STRICT;

CREATE TABLE street_segments (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  street_name TEXT NOT NULL,
  geometry_geojson TEXT NOT NULL,
  estimated_homes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_homes >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE coverage_events (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  street_segment_id TEXT NOT NULL REFERENCES street_segments(id) ON DELETE CASCADE,
  covered_on TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completed', 'correction')),
  corrects_event_id TEXT REFERENCES coverage_events(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'finalized', 'reconciled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT
) STRICT;

CREATE TABLE packets (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  packet_code TEXT NOT NULL,
  start_address TEXT NOT NULL,
  estimated_homes INTEGER NOT NULL CHECK (estimated_homes >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (church_id, packet_code)
) STRICT;

CREATE TABLE packet_segments (
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  street_segment_id TEXT NOT NULL REFERENCES street_segments(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  PRIMARY KEY (packet_id, street_segment_id),
  UNIQUE (packet_id, sequence_number)
) STRICT;
