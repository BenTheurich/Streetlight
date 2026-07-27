ALTER TABLE territories
  ADD COLUMN import_kind TEXT NOT NULL DEFAULT 'proof'
  CHECK (import_kind IN ('proof', 'overture'));
ALTER TABLE territories ADD COLUMN import_release TEXT;
ALTER TABLE territories ADD COLUMN import_center_latitude REAL;
ALTER TABLE territories ADD COLUMN import_center_longitude REAL;
ALTER TABLE territories ADD COLUMN import_radius_meters REAL;
ALTER TABLE territories ADD COLUMN import_completed_at TEXT;
ALTER TABLE street_segments
  ADD COLUMN road_class TEXT NOT NULL DEFAULT 'residential';

DELETE FROM packet_segments WHERE packet_id = 'packet-foundation-001';
DELETE FROM coverage_events WHERE id = 'coverage-foundation-001';
DELETE FROM packets WHERE id = 'packet-foundation-001';
DELETE FROM batches WHERE id = 'batch-foundation-001';
