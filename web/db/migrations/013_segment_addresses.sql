CREATE TABLE segment_addresses (
  id INTEGER PRIMARY KEY,
  street_segment_id TEXT NOT NULL REFERENCES street_segments(id) ON DELETE CASCADE,
  house_number TEXT,
  street TEXT NOT NULL CHECK (length(trim(street)) > 0),
  locality TEXT,
  postcode TEXT,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL
) STRICT;

CREATE INDEX segment_addresses_segment ON segment_addresses (street_segment_id);
