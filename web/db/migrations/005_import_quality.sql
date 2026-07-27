ALTER TABLE territories
  ADD COLUMN import_total_addresses INTEGER CHECK (import_total_addresses >= 0);
ALTER TABLE territories
  ADD COLUMN import_assigned_addresses INTEGER CHECK (import_assigned_addresses >= 0);
ALTER TABLE territories
  ADD COLUMN import_inferred_roads INTEGER CHECK (import_inferred_roads >= 0);
ALTER TABLE territories
  ADD COLUMN import_unmatched_addresses INTEGER CHECK (import_unmatched_addresses >= 0);
ALTER TABLE territories
  ADD COLUMN import_normalizer_version INTEGER CHECK (import_normalizer_version >= 0);
