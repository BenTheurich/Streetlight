ALTER TABLE street_segments
  ADD COLUMN road_group_id TEXT NOT NULL DEFAULT '';
ALTER TABLE street_segments
  ADD COLUMN activation_kind TEXT NOT NULL DEFAULT 'automatic'
  CHECK (activation_kind IN ('automatic', 'hidden', 'manual'));

UPDATE street_segments
SET road_group_id = import_segment_id
WHERE road_group_id = '';

ALTER TABLE territories
  ADD COLUMN import_unresolved_clusters INTEGER
  CHECK (import_unresolved_clusters IS NULL OR
    (typeof(import_unresolved_clusters) = 'integer' AND import_unresolved_clusters >= 0));

CREATE INDEX street_segments_current_road_group
ON street_segments (church_id, territory_id, road_group_id)
WHERE is_current = 1;
