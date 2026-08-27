ALTER TABLE territories
ADD COLUMN import_building_mode TEXT
CHECK (import_building_mode IN ('overture_fema', 'overture_only'));

ALTER TABLE batches
ADD COLUMN import_generation INTEGER NOT NULL DEFAULT 0
CHECK (import_generation >= 0);

ALTER TABLE street_segments
ADD COLUMN import_generation INTEGER NOT NULL DEFAULT 0
CHECK (import_generation >= 0);

UPDATE street_segments
SET import_generation = CAST(substr(id, instr(id, '@') + 1) AS INTEGER)
WHERE instr(id, '@') > 0;

UPDATE batches
SET import_generation = COALESCE(
  (
    SELECT MIN(s.import_generation)
    FROM packets p
    JOIN packet_segments ps ON ps.packet_id = p.id
    JOIN street_segments s ON s.id = ps.street_segment_id
    WHERE p.batch_id = batches.id
  ),
  (
    SELECT MIN(a.import_generation)
    FROM packets p
    JOIN packet_apartment_complexes pa ON pa.packet_id = p.id
    JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
    WHERE p.batch_id = batches.id
  ),
  0
);

CREATE TABLE map_buildings (
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  import_generation INTEGER NOT NULL CHECK (import_generation >= 0),
  source TEXT NOT NULL CHECK (source IN ('overture', 'fema')),
  source_feature_id TEXT NOT NULL CHECK (length(trim(source_feature_id)) > 0),
  geometry_geojson TEXT NOT NULL,
  overture_release TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  fema_address_source_id TEXT,
  fema_distance_meters REAL,
  fema_occupancy TEXT,
  fema_outbuilding INTEGER CHECK (fema_outbuilding IN (0, 1)),
  fema_source TEXT,
  fema_product_date TEXT,
  fema_image_date TEXT,
  PRIMARY KEY (
    church_id,
    territory_id,
    import_generation,
    source,
    source_feature_id
  ),
  CHECK (
    (source = 'overture'
      AND fema_address_source_id IS NULL
      AND fema_distance_meters IS NULL
      AND fema_occupancy IS NULL
      AND fema_outbuilding IS NULL)
    OR
    (source = 'fema'
      AND length(trim(fema_address_source_id)) > 0
      AND fema_distance_meters BETWEEN 0 AND 10
      AND fema_occupancy = 'Single Family Dwelling'
      AND fema_outbuilding = 0)
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX map_buildings_generation
ON map_buildings (church_id, territory_id, import_generation);
