ALTER TABLE territories
ADD COLUMN import_generation INTEGER NOT NULL DEFAULT 0
CHECK (import_generation >= 0);

ALTER TABLE street_segments
ADD COLUMN import_segment_id TEXT NOT NULL DEFAULT '';

ALTER TABLE street_segments
ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1
CHECK (is_current IN (0, 1));

UPDATE street_segments
SET import_segment_id = id;

CREATE UNIQUE INDEX street_segments_current_import_id
ON street_segments (church_id, territory_id, import_segment_id)
WHERE is_current = 1;
