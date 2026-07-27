ALTER TABLE territories
ADD COLUMN origin_address TEXT NOT NULL DEFAULT '';

ALTER TABLE street_segments
ADD COLUMN source_segment_id TEXT;

CREATE TABLE ignore_zones (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  geometry_geojson TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

DELETE FROM coverage_events
WHERE id = 'coverage-foundation-001';

DELETE FROM packet_segments
WHERE packet_id = 'packet-foundation-001';

DELETE FROM packets
WHERE id = 'packet-foundation-001';

DELETE FROM batches
WHERE id = 'batch-foundation-001';

DELETE FROM street_segments
WHERE id = 'segment-foundation-001';
