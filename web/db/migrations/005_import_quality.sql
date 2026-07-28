ALTER TABLE territories
  ADD COLUMN import_total_addresses INTEGER
  CHECK (import_total_addresses IS NULL OR (typeof(import_total_addresses) = 'integer' AND import_total_addresses >= 0));
ALTER TABLE territories
  ADD COLUMN import_assigned_addresses INTEGER
  CHECK (import_assigned_addresses IS NULL OR (typeof(import_assigned_addresses) = 'integer' AND import_assigned_addresses >= 0));
ALTER TABLE territories
  ADD COLUMN import_inferred_roads INTEGER
  CHECK (import_inferred_roads IS NULL OR (typeof(import_inferred_roads) = 'integer' AND import_inferred_roads >= 0));
ALTER TABLE territories
  ADD COLUMN import_unmatched_addresses INTEGER
  CHECK (import_unmatched_addresses IS NULL OR (typeof(import_unmatched_addresses) = 'integer' AND import_unmatched_addresses >= 0));
ALTER TABLE territories
  ADD COLUMN import_normalizer_version INTEGER
  CHECK (import_normalizer_version IS NULL OR (typeof(import_normalizer_version) = 'integer' AND import_normalizer_version >= 0));
