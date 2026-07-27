ALTER TABLE coverage_events
ADD COLUMN is_void INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0, 1));

CREATE INDEX coverage_events_church_segment
ON coverage_events (church_id, street_segment_id);

CREATE INDEX coverage_events_correction_root
ON coverage_events (corrects_event_id);

CREATE TRIGGER coverage_events_no_update
BEFORE UPDATE ON coverage_events
BEGIN
  SELECT RAISE(ABORT, 'coverage_events are append-only');
END;

CREATE TRIGGER coverage_events_no_delete
BEFORE DELETE ON coverage_events
BEGIN
  SELECT RAISE(ABORT, 'coverage_events are append-only');
END;

CREATE TRIGGER coverage_events_validate_insert
BEFORE INSERT ON coverage_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM street_segments
    WHERE id = NEW.street_segment_id AND church_id = NEW.church_id
  ) THEN RAISE(ABORT, 'coverage_events church must own segment') END;

  SELECT CASE WHEN NEW.kind = 'completed' AND
    (NEW.corrects_event_id IS NOT NULL OR NEW.is_void != 0)
  THEN RAISE(ABORT, 'coverage_events completed shape is invalid') END;

  SELECT CASE WHEN NEW.kind = 'correction' AND NEW.corrects_event_id IS NULL
  THEN RAISE(ABORT, 'coverage_events correction requires root') END;

  SELECT CASE WHEN NEW.kind = 'correction' AND NOT EXISTS (
    SELECT 1 FROM coverage_events root
    WHERE root.id = NEW.corrects_event_id
      AND root.kind = 'completed'
      AND root.church_id = NEW.church_id
      AND root.street_segment_id = NEW.street_segment_id
  ) THEN RAISE(ABORT, 'coverage_events correction root is invalid') END;

  SELECT CASE WHEN NEW.kind = 'correction' AND NEW.is_void = 1
    AND NEW.covered_on <> COALESCE(
      (SELECT covered_on FROM coverage_events
        WHERE corrects_event_id = NEW.corrects_event_id AND is_void = 0
        ORDER BY rowid DESC LIMIT 1),
      (SELECT covered_on FROM coverage_events WHERE id = NEW.corrects_event_id)
    )
  THEN RAISE(ABORT, 'coverage_events void date is invalid') END;
END;
