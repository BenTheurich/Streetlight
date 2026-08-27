ALTER TABLE apartment_complexes
ADD COLUMN site_name TEXT;

ALTER TABLE apartment_complexes
ADD COLUMN boundary_geojson TEXT
CHECK (boundary_geojson IS NULL OR json_valid(boundary_geojson));

ALTER TABLE apartment_complexes
ADD COLUMN grouping_kind TEXT NOT NULL DEFAULT 'ungrouped'
CHECK (grouping_kind IN ('source_boundary', 'ungrouped', 'admin_group'));

ALTER TABLE apartment_complexes
ADD COLUMN grouping_confirmed INTEGER NOT NULL DEFAULT 0
CHECK (grouping_confirmed IN (0, 1));

ALTER TABLE apartment_complexes
ADD COLUMN address_confirmed INTEGER NOT NULL DEFAULT 0
CHECK (address_confirmed IN (0, 1));

ALTER TABLE apartment_complexes
ADD COLUMN confirmed_tracts INTEGER
CHECK (confirmed_tracts IS NULL OR confirmed_tracts >= 1);

ALTER TABLE apartment_complexes
ADD COLUMN access_status TEXT NOT NULL DEFAULT 'unknown'
CHECK (access_status IN ('unknown', 'open', 'restricted'));

ALTER TABLE apartment_complexes
ADD COLUMN included_in_packets INTEGER NOT NULL DEFAULT 0
CHECK (included_in_packets IN (0, 1));

ALTER TABLE apartment_complexes
ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(members_json));

UPDATE apartment_complexes
SET members_json = json_array(
  json_object(
    'id', import_complex_id,
    'sourceId', source_id,
    'address', address,
    'position', json_array(longitude, latitude),
    'geometry', NULL,
    'apartmentBuilding', json(CASE apartment_building WHEN 1 THEN 'true' ELSE 'false' END),
    'distinctUnits', distinct_units
  )
);
