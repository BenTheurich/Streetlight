PRAGMA defer_foreign_keys = ON;

DROP TRIGGER coverage_events_no_update;
DROP TRIGGER coverage_events_no_delete;
DROP TRIGGER coverage_events_validate_insert;

ALTER TABLE coverage_events RENAME TO coverage_events_legacy;

CREATE TABLE coverage_events (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  street_segment_id TEXT REFERENCES street_segments(id) ON DELETE RESTRICT,
  apartment_complex_id TEXT REFERENCES apartment_complexes(id) ON DELETE RESTRICT,
  packet_id TEXT REFERENCES packets(id) ON DELETE RESTRICT,
  completion_group_id TEXT,
  covered_on TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completed', 'correction')),
  corrects_event_id TEXT REFERENCES coverage_events(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_void INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0, 1)),
  CHECK ((street_segment_id IS NULL) != (apartment_complex_id IS NULL)),
  CHECK ((packet_id IS NULL) = (completion_group_id IS NULL))
) STRICT;

INSERT INTO coverage_events
  (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, created_at, is_void)
SELECT id, church_id, street_segment_id, covered_on, kind, corrects_event_id, created_at, is_void
FROM coverage_events_legacy
ORDER BY rowid;

DROP TABLE coverage_events_legacy;

CREATE INDEX coverage_events_church_segment
ON coverage_events (church_id, street_segment_id);

CREATE INDEX coverage_events_church_apartment
ON coverage_events (church_id, apartment_complex_id);

CREATE INDEX coverage_events_packet
ON coverage_events (packet_id, completion_group_id);

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
  SELECT CASE WHEN NEW.street_segment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM street_segments
    WHERE id = NEW.street_segment_id AND church_id = NEW.church_id
  ) THEN RAISE(ABORT, 'coverage_events church must own segment') END;

  SELECT CASE WHEN NEW.apartment_complex_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM apartment_complexes
    WHERE id = NEW.apartment_complex_id AND church_id = NEW.church_id
  ) THEN RAISE(ABORT, 'coverage_events church must own apartment') END;

  SELECT CASE WHEN NEW.packet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM packets p
    WHERE p.id = NEW.packet_id
      AND p.church_id = NEW.church_id
      AND (
        (
          NEW.street_segment_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM packet_segments ps
            WHERE ps.packet_id = p.id
              AND ps.church_id = p.church_id
              AND ps.street_segment_id = NEW.street_segment_id
          )
        )
        OR
        (
          NEW.apartment_complex_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM packet_apartment_complexes pa
            WHERE pa.packet_id = p.id
              AND pa.church_id = p.church_id
              AND pa.apartment_complex_id = NEW.apartment_complex_id
          )
        )
      )
  ) THEN RAISE(ABORT, 'coverage_events packet must own target') END;

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
      AND root.street_segment_id IS NEW.street_segment_id
      AND root.apartment_complex_id IS NEW.apartment_complex_id
      AND root.packet_id IS NEW.packet_id
      AND root.completion_group_id IS NEW.completion_group_id
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
