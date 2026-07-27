DROP TRIGGER coverage_events_validate_insert;

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

  SELECT CASE WHEN NEW.kind = 'correction' AND NEW.is_void = 1 AND (
    COALESCE(
      (SELECT is_void FROM coverage_events
        WHERE corrects_event_id = NEW.corrects_event_id
        ORDER BY rowid DESC LIMIT 1),
      0
    ) = 1
    OR NEW.covered_on <> COALESCE(
      (SELECT covered_on FROM coverage_events
        WHERE corrects_event_id = NEW.corrects_event_id
        ORDER BY rowid DESC LIMIT 1),
      (SELECT covered_on FROM coverage_events WHERE id = NEW.corrects_event_id)
    )
  ) THEN RAISE(ABORT, 'coverage_events void state is invalid') END;
END;
