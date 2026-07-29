ALTER TABLE territories
  ADD COLUMN import_spatially_assigned_addresses INTEGER
  CHECK (import_spatially_assigned_addresses IS NULL OR (typeof(import_spatially_assigned_addresses) = 'integer' AND import_spatially_assigned_addresses >= 0));
ALTER TABLE territories
  ADD COLUMN import_total_residential_buildings INTEGER
  CHECK (import_total_residential_buildings IS NULL OR (typeof(import_total_residential_buildings) = 'integer' AND import_total_residential_buildings >= 0));
ALTER TABLE territories
  ADD COLUMN import_fallback_buildings INTEGER
  CHECK (import_fallback_buildings IS NULL OR (typeof(import_fallback_buildings) = 'integer' AND import_fallback_buildings >= 0));
ALTER TABLE territories
  ADD COLUMN import_unmatched_residential_buildings INTEGER
  CHECK (import_unmatched_residential_buildings IS NULL OR (typeof(import_unmatched_residential_buildings) = 'integer' AND import_unmatched_residential_buildings >= 0));
ALTER TABLE territories
  ADD COLUMN import_populated_unnamed_roads INTEGER
  CHECK (import_populated_unnamed_roads IS NULL OR (typeof(import_populated_unnamed_roads) = 'integer' AND import_populated_unnamed_roads >= 0));
ALTER TABLE territories
  ADD COLUMN import_building_address_disagreements INTEGER
  CHECK (import_building_address_disagreements IS NULL OR (typeof(import_building_address_disagreements) = 'integer' AND import_building_address_disagreements >= 0));
ALTER TABLE territories
  ADD COLUMN import_quality_warnings_json TEXT NOT NULL DEFAULT '[]';
