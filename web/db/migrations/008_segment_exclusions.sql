ALTER TABLE street_segments
ADD COLUMN manually_excluded INTEGER NOT NULL DEFAULT 0
CHECK (manually_excluded IN (0, 1));
