import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
  saveTerritoryDraft as saveContainedTerritoryDraft,
} from '../lib/territory-persistence.ts';
import {
  importedSegmentFixture,
  importedTerritoryFixture,
  withSeededTemeculaDatabase,
} from '../test/persistence-fixtures.ts';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

function saveTerritoryDraft(draft, options = {}) {
  const { imported, ...persistenceOptions } = options;
  return imported
    ? replaceTerritoryFromImport(draft, imported, persistenceOptions)
    : saveContainedTerritoryDraft(draft, persistenceOptions);
}

test('migration and seed create the church-owned Phase 2 territory graph', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-database-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);

  try {
    migrateDatabase(database);
    migrateDatabase(database);
    seedDatabase(database);
    seedDatabase(database);

    const expectedTables = [
      'churches',
      'administrators',
      'territories',
      'street_segments',
      'coverage_events',
      'batches',
      'packets',
      'packet_segments',
      'segment_addresses',
      'apartment_complexes',
    ];

    const emptyTables = new Set([
      'coverage_events',
      'batches',
      'packets',
      'packet_segments',
      'segment_addresses',
      'apartment_complexes',
    ]);
    for (const table of expectedTables) {
      const expected = table === 'street_segments' ? 55 : emptyTables.has(table) ? 0 : 1;
      assert.equal(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        expected,
      );
    }

    const segments = database
      .prepare(
        `SELECT COUNT(*) AS count, SUM(estimated_homes) AS homes,
          COUNT(DISTINCT church_id) AS churches
        FROM street_segments
        WHERE church_id = ? AND territory_id = ?`,
      )
      .get('church-temecula-pilot', 'territory-temecula-pilot');

    assert.deepEqual({ ...segments }, { count: 55, homes: 427, churches: 1 });
  } finally {
    database.close();
  }

  try {
    const workspace = withTemeculaWorkspace(() => getTerritoryWorkspace(filename));
    assert.deepEqual(workspace.center, [-117.1164623, 33.5414958]);
    assert.equal(workspace.import.kind, 'proof');
    assert.equal(workspace.import.release, null);
    assert.equal(workspace.import.normalizerVersion, null);
    assert.equal(workspace.import.quality, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 027 turns legacy apartment rows into unconfigured sites without breaking packet targets', () => {
  const database = openDatabase(':memory:');
  try {
    database.exec(`
      CREATE TABLE apartment_complexes (
        id TEXT PRIMARY KEY,
        church_id TEXT NOT NULL,
        territory_id TEXT NOT NULL,
        import_complex_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        address TEXT,
        longitude REAL NOT NULL,
        latitude REAL NOT NULL,
        estimated_tracts INTEGER NOT NULL,
        apartment_building INTEGER NOT NULL,
        distinct_units INTEGER NOT NULL,
        review_status TEXT NOT NULL,
        import_generation INTEGER NOT NULL,
        is_current INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      CREATE TABLE packet_apartment_complexes (
        church_id TEXT NOT NULL,
        packet_id TEXT PRIMARY KEY,
        apartment_complex_id TEXT NOT NULL REFERENCES apartment_complexes(id)
      ) STRICT;
      INSERT INTO apartment_complexes VALUES
        ('legacy-site', 'church', 'territory', 'legacy-import', 'building-1',
          '10 Sample Road', -117.1, 33.5, 18, 1, 12, 'ready', 1, 1, CURRENT_TIMESTAMP);
      INSERT INTO packet_apartment_complexes VALUES ('church', 'packet', 'legacy-site');
    `);

    database.exec(
      readFileSync(
        path.join(import.meta.dirname, 'migrations', '027_apartment_site_model.sql'),
        'utf8',
      ),
    );

    const site = database.prepare('SELECT * FROM apartment_complexes').get();
    assert.equal(site.grouping_kind, 'ungrouped');
    assert.equal(site.grouping_confirmed, 0);
    assert.equal(site.address_confirmed, 0);
    assert.equal(site.confirmed_tracts, null);
    assert.equal(site.access_status, 'unknown');
    assert.equal(site.included_in_packets, 0);
    assert.deepEqual(JSON.parse(site.members_json), [
      {
        id: 'legacy-import',
        sourceId: 'building-1',
        address: '10 Sample Road',
        position: [-117.1, 33.5],
        geometry: null,
        apartmentBuilding: true,
        distinctUnits: 12,
      },
    ]);
    assert.equal(
      database
        .prepare(
          `SELECT a.import_complex_id
          FROM packet_apartment_complexes p
          JOIN apartment_complexes a ON a.id = p.apartment_complex_id`,
        )
        .get().import_complex_id,
      'legacy-import',
    );
  } finally {
    database.close();
  }
});

test('migration 011 upgrades an existing migration 010 database with current-state void validation', () => {
  const database = openDatabase(':memory:');
  try {
    database.exec(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      INSERT INTO schema_migrations (name) VALUES
        ('011_coverage_void_invariant.sql'),
        ('018_reconciliation.sql');
    `);
    migrateDatabase(database);
    assert.ok(
      database
        .prepare('SELECT 1 FROM schema_migrations WHERE name = ?')
        .get('010_coverage_history.sql'),
    );
    seedDatabase(database);
    const segmentId = database
      .prepare('SELECT id FROM street_segments WHERE church_id = ? ORDER BY id LIMIT 1')
      .get('church-temecula-pilot').id;
    const insert = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
      VALUES (?, 'church-temecula-pilot', ?, ?, ?, ?, ?)`,
    );
    insert.run('upgrade-root', segmentId, '2026-07-01', 'completed', null, 0);
    insert.run('old-first-void', segmentId, '2026-07-01', 'correction', 'upgrade-root', 1);
    insert.run('old-second-void', segmentId, '2026-07-01', 'correction', 'upgrade-root', 1);

    database
      .prepare('DELETE FROM schema_migrations WHERE name = ?')
      .run('011_coverage_void_invariant.sql');
    migrateDatabase(database);

    assert.ok(
      database
        .prepare('SELECT 1 FROM schema_migrations WHERE name = ?')
        .get('011_coverage_void_invariant.sql'),
    );
    assert.throws(
      () =>
        insert.run(
          'upgraded-consecutive-void',
          segmentId,
          '2026-07-01',
          'correction',
          'upgrade-root',
          1,
        ),
      /coverage_events/i,
    );
    insert.run('upgraded-restoration', segmentId, '2026-07-02', 'correction', 'upgrade-root', 0);
    assert.throws(
      () =>
        insert.run(
          'upgraded-wrong-date-void',
          segmentId,
          '2026-07-01',
          'correction',
          'upgrade-root',
          1,
        ),
      /coverage_events/i,
    );
    insert.run(
      'upgraded-matching-revoid',
      segmentId,
      '2026-07-02',
      'correction',
      'upgrade-root',
      1,
    );
  } finally {
    database.close();
  }
});

test('import quality columns accept only nullable non-negative integers', () => {
  const database = openDatabase(':memory:');
  try {
    database.exec(
      "CREATE TABLE territories (id TEXT PRIMARY KEY); INSERT INTO territories VALUES ('territory');",
    );
    database.exec(
      readFileSync(path.join(import.meta.dirname, 'migrations', '005_import_quality.sql'), 'utf8'),
    );
    for (const column of [
      'import_total_addresses',
      'import_assigned_addresses',
      'import_inferred_roads',
      'import_unmatched_addresses',
      'import_normalizer_version',
    ]) {
      const update = database.prepare(`UPDATE territories SET ${column} = ?`);
      assert.throws(() => update.run(1.5), /CHECK constraint failed/);
      update.run(null);
      update.run(0);
    }
  } finally {
    database.close();
  }
});

test('migration 015 warns for a known low-quality legacy Overture import', () => {
  const database = openDatabase(':memory:');
  try {
    database.exec(`
      CREATE TABLE territories (
        id TEXT PRIMARY KEY,
        import_kind TEXT,
        import_total_addresses INTEGER,
        import_assigned_addresses INTEGER,
        import_normalizer_version INTEGER
      ) STRICT;
      INSERT INTO territories VALUES ('legacy', 'overture', 100, 80, 6);
    `);
    database.exec(
      readFileSync(
        path.join(import.meta.dirname, 'migrations', '014_import_quality_evidence.sql'),
        'utf8',
      ),
    );
    database.exec(
      readFileSync(
        path.join(import.meta.dirname, 'migrations', '015_backfill_legacy_import_warnings.sql'),
        'utf8',
      ),
    );

    const row = database.prepare('SELECT * FROM territories WHERE id = ?').get('legacy');
    assert.equal(row.import_spatially_assigned_addresses, 0);
    assert.equal(row.import_total_residential_buildings, 0);
    assert.deepEqual(JSON.parse(row.import_quality_warnings_json), [
      'Address matching is below the 95% reliability target (80.0% matched).',
    ]);
  } finally {
    database.close();
  }
});

test('migration 022 advances only finalized street batches with identical map geography', () => {
  const database = openDatabase(':memory:');
  try {
    migrateDatabase(database);
    database.exec(`
      INSERT INTO churches (id, name) VALUES
        ('safe-church', 'Safe Church'),
        ('changed-church', 'Changed Church');
      INSERT INTO territories
        (id, church_id, name, center_latitude, center_longitude, radius_meters,
          boundary_geojson, import_generation)
      VALUES
        ('safe-territory', 'safe-church', 'Safe', 1, 1, 1000, '{}', 2),
        ('changed-territory', 'changed-church', 'Changed', 1, 1, 1000, '{}', 2);
      INSERT INTO street_segments
        (id, church_id, territory_id, street_name, geometry_geojson, estimated_homes,
          import_segment_id, is_current, import_generation)
      VALUES
        ('safe@1', 'safe-church', 'safe-territory', 'Safe Road', '[[0,0],[1,1]]', 10,
          'safe', 0, 1),
        ('safe@2', 'safe-church', 'safe-territory', 'Safe Road', '[[0,0],[1,1]]', 10,
          'safe', 1, 2),
        ('changed@1', 'changed-church', 'changed-territory', 'Changed Road',
          '[[0,0],[1,1]]', 10, 'changed', 0, 1),
        ('changed@2', 'changed-church', 'changed-territory', 'Changed Road',
          '[[0,0],[1,1]]', 10, 'changed', 1, 2);
      INSERT INTO segment_addresses
        (street_segment_id, house_number, street, longitude, latitude)
      VALUES
        ('safe@1', '10', 'Safe Road', 1, 1),
        ('safe@2', '10', 'Safe Road', 1, 1),
        ('changed@1', '20', 'Changed Road', 1, 1),
        ('changed@2', '22', 'Changed Road', 1, 1);
      INSERT INTO batches (id, church_id, name, status, finalized_at, import_generation) VALUES
        ('safe-batch', 'safe-church', 'Safe', 'finalized', CURRENT_TIMESTAMP, 1),
        ('changed-batch', 'changed-church', 'Changed', 'finalized', CURRENT_TIMESTAMP, 1);
      INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
      VALUES
        ('safe-packet', 'safe-church', 'safe-batch', 'SAFE', '10 Safe Road', 10, 'active'),
        ('changed-packet', 'changed-church', 'changed-batch', 'CHANGED', '20 Changed Road',
          10, 'active');
      INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES
        ('safe-church', 'safe-packet', 'safe@1', 0),
        ('changed-church', 'changed-packet', 'changed@1', 0);
      INSERT INTO map_buildings
        (church_id, territory_id, import_generation, source, source_feature_id,
          geometry_geojson, overture_release, retrieved_at)
      VALUES
        ('safe-church', 'safe-territory', 2, 'overture', 'safe-building', '{}', 'release',
          CURRENT_TIMESTAMP),
        ('changed-church', 'changed-territory', 2, 'overture', 'changed-building', '{}',
          'release', CURRENT_TIMESTAMP);
    `);

    database.exec(
      readFileSync(
        path.join(import.meta.dirname, 'migrations', '022_backfill_packet_map_generations.sql'),
        'utf8',
      ),
    );

    assert.deepEqual(
      database
        .prepare('SELECT id, import_generation FROM batches ORDER BY id')
        .all()
        .map((row) => ({ ...row })),
      [
        { id: 'changed-batch', import_generation: 1 },
        { id: 'safe-batch', import_generation: 2 },
      ],
    );
  } finally {
    database.close();
  }
});

test('migration 023 persists the approved legacy FEMA row gaps', () => {
  const database = openDatabase(':memory:');
  try {
    migrateDatabase(database);
    database.exec(`
      INSERT INTO churches (id, name)
      VALUES ('church-temecula-pilot', 'Temecula Pilot');
      INSERT INTO territories
        (id, church_id, name, center_latitude, center_longitude, radius_meters,
          boundary_geojson, import_generation, import_release, import_completed_at)
      VALUES
        ('territory-temecula-pilot', 'church-temecula-pilot', 'Pilot', 33.54, -117.12,
          1609.344, '{}', 9, '2026-06-17.0', '2026-07-30T00:00:00.000Z');
    `);

    database.exec(
      readFileSync(
        path.join(import.meta.dirname, 'migrations', '023_persist_legacy_fema_row_gaps.sql'),
        'utf8',
      ),
    );

    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM map_buildings
          WHERE church_id = 'church-temecula-pilot'
            AND territory_id = 'territory-temecula-pilot'
            AND import_generation = 9
            AND source = 'fema'`,
        )
        .get().count,
      11,
    );
    assert.deepEqual(
      JSON.parse(
        database
          .prepare(
            `SELECT geometry_geojson FROM map_buildings
            WHERE source_feature_id = '6027521'`,
          )
          .get().geometry_geojson,
      ),
      {
        type: 'Polygon',
        coordinates: [
          [
            [-117.0974739, 33.518515],
            [-117.097551, 33.5184975],
            [-117.0975754, 33.5185729],
            [-117.0974082, 33.5186108],
            [-117.097349, 33.5184277],
            [-117.097439, 33.5184073],
            [-117.0974739, 33.518515],
          ],
        ],
      },
    );
  } finally {
    database.close();
  }
});

test('coverage threshold columns enforce ascending values', () => {
  withSeededTemeculaDatabase((filename) => {
    const database = openDatabase(filename);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE territories
            SET coverage_yellow_after_days = 60, coverage_orange_after_days = 60`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    database.close();
  });
});

test('a replacement failure preserves the complete saved workspace', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: initial.radiusMiles,
        boundaryShape: initial.boundaryShape,
      },
      {
        filename,
        imported: importedTerritoryFixture([
          importedSegmentFixture('prior', 'Prior Road', 'residential', 4),
        ]),
      },
    );
    const before = getTerritoryWorkspace(filename);
    assert.deepEqual(before.import.quality, importedTerritoryFixture([]).quality);
    assert.throws(
      () =>
        saveTerritoryDraft(
          {
            originAddress: 'Rollback Address',
            center: [-117.2, 33.6],
            radiusMiles: 5,
            boundaryShape: 'circle',
          },
          {
            filename,
            imported: importedTerritoryFixture([
              importedSegmentFixture('duplicate', 'A Street', 'residential', 1),
              importedSegmentFixture('duplicate', 'B Street', 'residential', 1),
            ]),
          },
        ),
      /UNIQUE constraint failed/,
    );

    assert.deepEqual(getTerritoryWorkspace(filename), before);
  });
});

test('coverage events are append-only and only valid same-segment completed roots can be corrected', () => {
  withSeededTemeculaDatabase((filename) => {
    const database = openDatabase(filename);
    const segmentId = database
      .prepare('SELECT id FROM street_segments WHERE church_id = ? ORDER BY id LIMIT 1')
      .get('church-temecula-pilot').id;
    const otherSegmentId = database
      .prepare('SELECT id FROM street_segments WHERE church_id = ? AND id <> ? ORDER BY id LIMIT 1')
      .get('church-temecula-pilot', segmentId).id;
    database
      .prepare('INSERT INTO churches (id, name) VALUES (?, ?)')
      .run('other-church', 'Other Church');
    database
      .prepare(
        `INSERT INTO street_segments
          (id, church_id, territory_id, import_segment_id, street_name, geometry_geojson, estimated_homes)
        SELECT ?, ?, territory_id, ?, street_name, geometry_geojson, estimated_homes
        FROM street_segments WHERE id = ?`,
      )
      .run('other-segment', 'other-church', 'other-segment', segmentId);

    const insert = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    assert.throws(
      () =>
        insert.run('wrong-church', 'other-church', segmentId, '2026-07-01', 'completed', null, 0),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'bad-completed-target',
          'church-temecula-pilot',
          segmentId,
          '2026-07-01',
          'completed',
          'x',
          0,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'bad-completed-void',
          'church-temecula-pilot',
          segmentId,
          '2026-07-01',
          'completed',
          null,
          1,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'missing-root',
          'church-temecula-pilot',
          segmentId,
          '2026-07-01',
          'correction',
          'x',
          0,
        ),
      /coverage_events/i,
    );

    insert.run('root', 'church-temecula-pilot', segmentId, '2026-07-01', 'completed', null, 0);
    assert.throws(
      () =>
        insert.run(
          'wrong-root-date-void',
          'church-temecula-pilot',
          segmentId,
          '2026-07-02',
          'correction',
          'root',
          1,
        ),
      /coverage_events/i,
    );
    insert.run(
      'root-date-void',
      'church-temecula-pilot',
      segmentId,
      '2026-07-01',
      'correction',
      'root',
      1,
    );
    assert.throws(
      () =>
        insert.run(
          'consecutive-root-date-void',
          'church-temecula-pilot',
          segmentId,
          '2026-07-01',
          'correction',
          'root',
          1,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'correction-target',
          'church-temecula-pilot',
          segmentId,
          '2026-07-02',
          'correction',
          'root',
          2,
        ),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        insert.run(
          'other-segment-root',
          'church-temecula-pilot',
          otherSegmentId,
          '2026-07-02',
          'correction',
          'root',
          0,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'other-church-root',
          'other-church',
          'other-segment',
          '2026-07-02',
          'correction',
          'root',
          0,
        ),
      /coverage_events/i,
    );
    insert.run(
      'first-correction',
      'church-temecula-pilot',
      segmentId,
      '2026-07-02',
      'correction',
      'root',
      0,
    );
    assert.throws(
      () =>
        insert.run(
          'wrong-replacement-date-void',
          'church-temecula-pilot',
          segmentId,
          '2026-07-01',
          'correction',
          'root',
          1,
        ),
      /coverage_events/i,
    );
    insert.run(
      'replacement-date-void',
      'church-temecula-pilot',
      segmentId,
      '2026-07-02',
      'correction',
      'root',
      1,
    );
    assert.throws(
      () =>
        insert.run(
          'consecutive-replacement-date-void',
          'church-temecula-pilot',
          segmentId,
          '2026-07-02',
          'correction',
          'root',
          1,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        insert.run(
          'correction-of-correction',
          'church-temecula-pilot',
          segmentId,
          '2026-07-03',
          'correction',
          'first-correction',
          0,
        ),
      /coverage_events/i,
    );
    assert.throws(
      () =>
        database
          .prepare('UPDATE coverage_events SET covered_on = ? WHERE id = ?')
          .run('2026-07-04', 'root'),
      /coverage_events/i,
    );
    assert.throws(
      () => database.prepare('DELETE FROM coverage_events WHERE id = ?').run('root'),
      /coverage_events/i,
    );
    database.close();
  });
});
