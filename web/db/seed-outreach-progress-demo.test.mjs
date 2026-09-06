import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';
import {
  orderOutreachProgressSegments,
  seedOutreachProgressDemo,
} from './seed-outreach-progress-demo.mjs';

test('outreach progress demo visits neighborhood clusters instead of radiating from the church', () => {
  const segment = (id, longitude, latitude) => ({
    id,
    street_name: id,
    geometry_geojson: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [longitude, latitude],
        [longitude + 0.01, latitude + 0.01],
      ],
    }),
  });
  const ordered = orderOutreachProgressSegments([
    segment('northwest', 0, 2),
    segment('north', 1, 2),
    segment('northeast', 2, 2),
    segment('west', 0, 1),
    segment('center', 1, 1),
    segment('east', 2, 1),
    segment('southwest', 0, 0),
    segment('south', 1, 0),
    segment('southeast', 2, 0),
  ]);

  assert.deepEqual(
    ordered.map(({ id }) => id),
    [
      'north',
      'east',
      'south',
      'west',
      'northeast',
      'southwest',
      'northwest',
      'southeast',
      'center',
    ],
  );
});

test('outreach progress demo replaces history only in its guarded database copy', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-progress-demo-'));
  const sourceFilename = path.join(directory, 'streetlight.db');
  const demoFilename = path.join(directory, 'outreach-progress-demo.db');
  try {
    const source = openDatabase(sourceFilename);
    migrateDatabase(source);
    seedDatabase(source);
    const template = source
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = 'church-temecula-pilot' AND is_current = 1
        ORDER BY id LIMIT 1`,
      )
      .get();
    const cloneSegment = source.prepare(
      `INSERT INTO street_segments
        (id, church_id, territory_id, street_name, geometry_geojson, estimated_homes,
          source_segment_id, road_class, import_segment_id, is_current, road_group_id,
          activation_kind, manually_excluded, import_generation)
      SELECT ?, church_id, territory_id, street_name, geometry_geojson, estimated_homes,
        source_segment_id, road_class, ?, is_current, ?, activation_kind, manually_excluded,
        import_generation
      FROM street_segments WHERE id = ?`,
    );
    for (let index = 0; index < 60; index += 1) {
      const suffix = String(index).padStart(2, '0');
      cloneSegment.run(
        `progress-source-segment-${suffix}`,
        `progress-source-import-${suffix}`,
        `progress-source-group-${suffix}`,
        template.id,
      );
    }
    source
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
        VALUES (?, ?, ?, ?, 'completed', NULL, 0)`,
      )
      .run('source-history', 'church-temecula-pilot', template.id, '2025-01-01');
    source
      .prepare("UPDATE territories SET boundary_shape = 'square' WHERE id = ?")
      .run('territory-temecula-pilot');
    source
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES (?, ?, ?, 'reconciled', ?)`,
      )
      .run('source-batch', 'church-temecula-pilot', 'Source batch', '2025-01-01T12:00:00.000Z');
    source
      .prepare('INSERT INTO churches (id, name) VALUES (?, ?)')
      .run('church-other', 'Other Church');
    source
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES (?, ?, ?, 'reconciled', ?)`,
      )
      .run('other-batch', 'church-other', 'Other batch', '2025-01-01T12:00:00.000Z');
    source.close();
    const sourceBefore = readFileSync(sourceFilename);

    assert.throws(
      () =>
        seedOutreachProgressDemo(
          path.join(directory, 'streetlight.db'),
          '2026-08-27',
          sourceFilename,
        ),
      /must be named outreach-progress-demo\.db/,
    );
    const result = seedOutreachProgressDemo(demoFilename, '2026-08-27', sourceFilename);

    assert.equal(result.target, demoFilename);
    assert.deepEqual(readFileSync(sourceFilename), sourceBefore);
    const demo = openDatabase(demoFilename);
    try {
      assert.equal(
        demo.prepare("SELECT name FROM churches WHERE id = 'church-temecula-pilot'").get().name,
        'Test Church',
      );
      assert.equal(
        demo
          .prepare("SELECT boundary_shape FROM territories WHERE id = 'territory-temecula-pilot'")
          .get().boundary_shape,
        'circle',
      );
      assert.equal(
        demo
          .prepare(
            `SELECT COUNT(DISTINCT covered_on) AS count FROM coverage_events
            WHERE church_id = 'church-temecula-pilot'`,
          )
          .get().count,
        52,
      );
      assert.equal(
        demo
          .prepare(
            `SELECT COUNT(*) AS count FROM packets
            WHERE church_id = 'church-temecula-pilot' AND id LIKE 'outreach-progress-demo-%'`,
          )
          .get().count,
        52,
      );
      assert.equal(
        demo
          .prepare("SELECT COUNT(*) AS count FROM coverage_events WHERE id = 'source-history'")
          .get().count,
        0,
      );
      assert.equal(
        demo.prepare("SELECT COUNT(*) AS count FROM batches WHERE id = 'source-batch'").get().count,
        0,
      );
      assert.equal(
        demo.prepare("SELECT COUNT(*) AS count FROM batches WHERE id = 'other-batch'").get().count,
        1,
      );
      assert.throws(
        () => demo.prepare('DELETE FROM coverage_events').run(),
        /coverage_events are append-only/,
      );
    } finally {
      demo.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
