CREATE TABLE apartment_complexes (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  import_complex_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  address TEXT,
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  estimated_tracts INTEGER NOT NULL CHECK (estimated_tracts >= 1),
  apartment_building INTEGER NOT NULL CHECK (apartment_building IN (0, 1)),
  distinct_units INTEGER NOT NULL CHECK (distinct_units >= 0),
  review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'ready', 'deferred')),
  import_generation INTEGER NOT NULL CHECK (import_generation >= 0),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE UNIQUE INDEX apartment_complexes_current_import_id
ON apartment_complexes (church_id, territory_id, import_complex_id)
WHERE is_current = 1;
