import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { countEligibleHomesCovered } from '../lib/coverage.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  getFoundationSummary,
  getPacketGenerationWorkspace,
  getTerritoryWorkspace,
  recordCoverageCompletion,
  saveCoverageThresholds,
  saveTerritoryDraft,
} from '../lib/database.ts';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

function withDatabase(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-database-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  try {
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function importedSegment(
  id,
  streetName,
  roadClass,
  estimatedHomes,
  activationKind = 'automatic',
  roadGroupId = `road-group:${id}`,
) {
  return {
    id,
    sourceSegmentId: `source-${id}`,
    roadGroupId,
    roadClass,
    streetName,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-117.1169, 33.5429],
        [-117.1168, 33.543],
      ],
    },
    estimatedHomes,
    addresses: [],
    activationKind,
  };
}

function importedTerritory(segments) {
  return {
    release: '2026-06-17.0',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 11,
    buildingMode: 'overture_fema',
    mapBuildings: [
      {
        source: 'overture',
        sourceId: 'building-one',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-117.117, 33.5429],
              [-117.1169, 33.5429],
              [-117.1169, 33.543],
              [-117.117, 33.5429],
            ],
          ],
        },
        fema: null,
      },
    ],
    quality: {
      totalAddresses: 12,
      assignedAddresses: 10,
      spatiallyAssignedAddresses: 3,
      inferredRoads: 1,
      unmatchedAddresses: 2,
      unresolvedClusters: 0,
      totalResidentialBuildings: 9,
      fallbackBuildings: 2,
      unmatchedResidentialBuildings: 1,
      populatedUnnamedRoads: 0,
      buildingAddressDisagreements: 1,
      warnings: ['Address matching is below the 95% reliability target (83.3% matched).'],
    },
    segments,
    apartmentComplexes: [],
  };
}

function importedApartment(id, address = '10 Sample Road, Temecula CA 92591') {
  return {
    id,
    sourceId: `source-${id}`,
    address,
    position: [-117.11685, 33.54295],
    estimatedTracts: 12,
    evidence: { apartmentBuilding: true, distinctUnits: 12 },
  };
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
    const summary = withTemeculaWorkspace(() => getFoundationSummary(filename));
    assert.deepEqual(workspace.center, [-117.1164623, 33.5414958]);
    assert.equal(workspace.import.kind, 'proof');
    assert.equal(workspace.import.release, null);
    assert.equal(workspace.import.normalizerVersion, null);
    assert.equal(workspace.import.quality, null);
    assert.equal(summary.packetCount, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('apartment imports default to review, preserve decisions, and retire missing complexes', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: initial.originAddress,
      center: initial.center,
      radiusMiles: 1,
      boundaryShape: 'circle',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
      apartmentStatuses: [],
    };
    saveTerritoryDraft(draft, {
      filename,
      imported: {
        ...importedTerritory([importedSegment('road', 'Sample Road', 'residential', 1)]),
        radiusMiles: 1,
        apartmentComplexes: [
          importedApartment('apartments-10'),
          importedApartment('units-20'),
          importedApartment('missing-address', null),
        ],
      },
    });

    const imported = getTerritoryWorkspace(filename);
    assert.deepEqual(
      imported.apartmentComplexes
        .map(({ id, reviewStatus, estimatedTracts }) => ({
          id,
          reviewStatus,
          estimatedTracts,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        { id: 'apartments-10', reviewStatus: 'needs_review', estimatedTracts: 12 },
        { id: 'missing-address', reviewStatus: 'needs_review', estimatedTracts: 12 },
        { id: 'units-20', reviewStatus: 'needs_review', estimatedTracts: 12 },
      ],
    );
    assert.throws(
      () =>
        saveTerritoryDraft(
          {
            ...draft,
            apartmentStatuses: [{ id: 'missing-address', reviewStatus: 'ready' }],
          },
          { filename },
        ),
      /not ready for outreach/,
    );

    saveTerritoryDraft(
      {
        ...draft,
        apartmentStatuses: [
          { id: 'apartments-10', reviewStatus: 'ready' },
          { id: 'units-20', reviewStatus: 'deferred' },
        ],
      },
      { filename },
    );
    saveTerritoryDraft(
      {
        ...draft,
        apartmentStatuses: [
          { id: 'apartments-10', reviewStatus: 'ready' },
          { id: 'units-20', reviewStatus: 'deferred' },
        ],
      },
      {
        filename,
        imported: {
          ...importedTerritory([importedSegment('road', 'Sample Road', 'residential', 1)]),
          radiusMiles: 1,
          apartmentComplexes: [importedApartment('apartments-10')],
        },
      },
    );

    const reimported = getTerritoryWorkspace(filename);
    assert.deepEqual(
      reimported.apartmentComplexes.map(({ id, reviewStatus }) => ({ id, reviewStatus })),
      [{ id: 'apartments-10', reviewStatus: 'ready' }],
    );
    const database = openDatabase(filename);
    try {
      assert.deepEqual(
        database
          .prepare(
            'SELECT import_complex_id, is_current FROM apartment_complexes ORDER BY import_complex_id, import_generation',
          )
          .all()
          .map((row) => ({ ...row })),
        [
          { import_complex_id: 'apartments-10', is_current: 0 },
          { import_complex_id: 'apartments-10', is_current: 1 },
          { import_complex_id: 'missing-address', is_current: 0 },
          { import_complex_id: 'units-20', is_current: 0 },
        ],
      );
    } finally {
      database.close();
    }
  });
});

test('circle and square boundaries control eligibility and coverage-map visibility', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    assert.equal(initial.boundaryShape, 'circle');
    const corner = {
      ...importedSegment('corner', 'Corner Road', 'residential', 8),
      geometry: {
        type: 'LineString',
        coordinates: [
          [initial.center[0] + 0.012, initial.center[1] + 0.012],
          [initial.center[0] + 0.013, initial.center[1] + 0.013],
        ],
      },
    };
    const baseDraft = {
      originAddress: initial.originAddress,
      center: initial.center,
      radiusMiles: 1,
      boundaryShape: 'circle',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    };

    saveTerritoryDraft(baseDraft, {
      filename,
      imported: { ...importedTerritory([corner]), radiusMiles: 1 },
    });
    const circle = getTerritoryWorkspace(filename);
    const circleSummary = getFoundationSummary(filename);
    assert.equal(circle.segments[0].withinBoundary, false);
    assert.equal(circle.segments[0].excludedReason, 'boundary');
    assert.deepEqual(circle.totals, {
      allSegments: 0,
      eligibleSegments: 0,
      allHomes: 0,
      eligibleHomes: 0,
    });
    assert.equal(circleSummary.segmentCount, 0);
    assert.equal(circleSummary.estimatedHomes, 0);
    assert.deepEqual(getCoverageWorkspace(filename).segments, []);

    saveTerritoryDraft(
      { ...baseDraft, boundaryShape: 'square' },
      {
        filename,
        imported: {
          ...importedTerritory([
            corner,
            { ...corner, id: 'hidden', streetName: 'Hidden Road', activationKind: 'hidden' },
          ]),
          radiusMiles: 1,
        },
      },
    );
    const square = getTerritoryWorkspace(filename);
    const squareSummary = getFoundationSummary(filename);
    assert.equal(square.boundaryShape, 'square');
    assert.equal(square.segments[0].withinBoundary, true);
    assert.equal(square.segments[0].eligible, true);
    assert.deepEqual(square.totals, {
      allSegments: 1,
      eligibleSegments: 1,
      allHomes: 8,
      eligibleHomes: 8,
    });
    assert.equal(squareSummary.segmentCount, 1);
    assert.equal(squareSummary.estimatedHomes, 8);
    assert.deepEqual(
      getCoverageWorkspace(filename).segments.map((segment) => segment.id),
      ['corner'],
    );
  });
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

test('an imported save atomically replaces proof segments and records its footprint', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const imported = importedTerritory([
      importedSegment('one', 'Residential Road', 'residential', 8),
      importedSegment('two', 'Calle Medusa', 'tertiary', 3),
    ]);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      { filename, imported },
    );
    const [one, two] = imported.segments.map(({ addresses: _addresses, ...segment }) => segment);

    const saved = getTerritoryWorkspace(filename);
    assert.deepEqual(saved.import, {
      kind: 'overture',
      release: imported.release,
      center: imported.center,
      radiusMiles: imported.radiusMiles,
      completedAt: imported.completedAt,
      normalizerVersion: imported.normalizerVersion,
      quality: imported.quality,
    });
    assert.deepEqual(
      saved.segments.map(
        ({
          id,
          sourceSegmentId,
          roadGroupId,
          roadClass,
          streetName,
          geometry,
          estimatedHomes,
          activationKind,
          active,
          eligible,
          excludedReason,
        }) => ({
          id,
          sourceSegmentId,
          roadGroupId,
          roadClass,
          streetName,
          geometry,
          estimatedHomes,
          activationKind,
          active,
          eligible,
          excludedReason,
        }),
      ),
      [
        {
          ...two,
          active: true,
          eligible: true,
          excludedReason: null,
        },
        {
          ...one,
          active: true,
          eligible: true,
          excludedReason: null,
        },
      ],
    );
    const database = openDatabase(filename);
    try {
      assert.deepEqual(
        {
          ...database
            .prepare(
              `SELECT source, source_feature_id, import_generation, geometry_geojson
              FROM map_buildings`,
            )
            .get(),
        },
        {
          source: 'overture',
          source_feature_id: 'building-one',
          import_generation: 1,
          geometry_geojson: JSON.stringify(imported.mapBuildings[0].geometry),
        },
      );
      assert.equal(
        database
          .prepare(
            `SELECT import_building_mode
            FROM territories WHERE id = 'territory-temecula-pilot'`,
          )
          .get().import_building_mode,
        'overture_fema',
      );
    } finally {
      database.close();
    }
  });
});

test('coverage workspace exposes concrete import warnings to packet generation', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const imported = importedTerritory([
      importedSegment('one', 'Residential Road', 'residential', 8),
    ]);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      { filename, imported },
    );

    assert.deepEqual(getCoverageWorkspace(filename).qualityWarnings, imported.quality.warnings);

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      {
        filename,
        imported: {
          ...imported,
          quality: {
            ...imported.quality,
            totalAddresses: 10,
            assignedAddresses: 10,
            unmatchedAddresses: 0,
            warnings: [],
          },
        },
      },
    );
    assert.deepEqual(getCoverageWorkspace(filename).qualityWarnings, []);
  });
});

test('reimport retains assigned addresses for imported and preserved manual segments', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const approvedGroup = 'road-group:approved';
    const approved = {
      ...importedSegment('approved', 'Diego Drive', 'service', 6, 'hidden', approvedGroup),
      addresses: [
        {
          number: '39483',
          street: 'Diego Drive',
          locality: 'Temecula',
          postcode: '92591',
          position: [-117.1157, 33.5435],
        },
        {
          number: null,
          street: 'Diego Drive',
          locality: null,
          postcode: null,
          position: [-117.1158, 33.5434],
        },
      ],
    };
    const draft = {
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles: workspace.radiusMiles,
      boundaryShape: workspace.boundaryShape,
      activatedSegmentIds: [approved.id],
    };

    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritory([approved]),
    });

    const firstDatabase = openDatabase(filename);
    const firstRows = firstDatabase
      .prepare(
        `SELECT s.id AS segment_id, a.house_number, a.street, a.locality, a.postcode,
          a.longitude, a.latitude
        FROM street_segments s
        JOIN segment_addresses a ON a.street_segment_id = s.id
        WHERE s.import_segment_id = ? AND s.is_current = 1
        ORDER BY a.id`,
      )
      .all('approved');
    firstDatabase.close();
    assert.deepEqual(
      firstRows.map((row) => ({ ...row })),
      [
        {
          segment_id: 'approved@1',
          house_number: '39483',
          street: 'Diego Drive',
          locality: 'Temecula',
          postcode: '92591',
          longitude: -117.1157,
          latitude: 33.5435,
        },
        {
          segment_id: 'approved@1',
          house_number: null,
          street: 'Diego Drive',
          locality: null,
          postcode: null,
          longitude: -117.1158,
          latitude: 33.5434,
        },
      ],
    );

    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritory([importedSegment('new-road', 'New Road', 'residential', 3)]),
    });

    const secondDatabase = openDatabase(filename);
    const secondRows = secondDatabase
      .prepare(
        `SELECT s.id AS segment_id, a.house_number, a.street, a.locality, a.postcode,
          a.longitude, a.latitude
        FROM street_segments s
        JOIN segment_addresses a ON a.street_segment_id = s.id
        WHERE s.import_segment_id = ? AND s.is_current = 1
        ORDER BY a.id`,
      )
      .all('approved');
    secondDatabase.close();
    assert.deepEqual(
      secondRows.map((row) => ({ ...row })),
      [
        {
          segment_id: 'approved@2',
          house_number: '39483',
          street: 'Diego Drive',
          locality: 'Temecula',
          postcode: '92591',
          longitude: -117.1157,
          latitude: 33.5435,
        },
        {
          segment_id: 'approved@2',
          house_number: null,
          street: 'Diego Drive',
          locality: null,
          postcode: null,
          longitude: -117.1158,
          latitude: 33.5434,
        },
      ],
    );
  });
});

test('packet generation workspace joins current addresses, eligibility, heatmap, and logical reservations', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const draft = {
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles: workspace.radiusMiles,
      boundaryShape: workspace.boundaryShape,
      activatedSegmentIds: [],
      excludedSegmentIds: ['excluded'],
    };
    const address = {
      number: '10',
      street: 'Current Road',
      locality: 'Temecula',
      postcode: '92591',
      position: [-117.1169, 33.5429],
    };
    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritory([
        { ...importedSegment('current', 'Current Road', 'residential', 8), addresses: [address] },
        importedSegment('excluded', 'Excluded Road', 'residential', 5),
        importedSegment('hidden', 'Hidden Road', 'service', 4, 'hidden'),
      ]),
    });

    const database = openDatabase(filename);
    const oldPhysicalId = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE import_segment_id = 'current' AND is_current = 1`,
      )
      .get().id;
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('reserved-batch', 'church-temecula-pilot', 'Reserved', 'finalized', CURRENT_TIMESTAMP)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES
          ('reserved-packet', 'church-temecula-pilot', 'reserved-batch', 'RES-001',
            '10 Current Road', 8, 'active')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
        VALUES ('church-temecula-pilot', 'reserved-packet', ?, 0)`,
      )
      .run(oldPhysicalId);
    database.close();

    saveTerritoryDraft(draft, {
      filename,
      imported: importedTerritory([
        {
          ...importedSegment('current', 'Current Road', 'residential', 8),
          addresses: [
            { ...address, number: '20' },
            { ...address, number: null },
          ],
        },
        importedSegment('excluded', 'Excluded Road', 'residential', 5),
        importedSegment('hidden', 'Hidden Road', 'service', 4, 'hidden'),
      ]),
    });

    const packetWorkspace = getPacketGenerationWorkspace(filename, '2026-07-28');
    const current = packetWorkspace.segments.find((segment) => segment.id === 'current');
    assert.deepEqual(current, {
      id: 'current',
      streetName: 'Current Road',
      geometry: importedSegment('current', 'Current Road', 'residential', 8).geometry,
      estimatedHomes: 8,
      eligible: true,
      reserved: true,
      coverageClass: 'red',
      lastCoveredOn: null,
      addresses: [
        { ...address, number: '20' },
        { ...address, number: null },
      ],
    });
    assert.equal(
      packetWorkspace.segments.find((segment) => segment.id === 'excluded').eligible,
      false,
    );
    assert.equal(
      packetWorkspace.segments.some((segment) => segment.id === 'hidden'),
      false,
    );

    const statusDatabase = openDatabase(filename);
    statusDatabase
      .prepare("UPDATE packets SET status = 'completed' WHERE id = 'reserved-packet'")
      .run();
    statusDatabase.close();
    assert.equal(
      getPacketGenerationWorkspace(filename, '2026-07-28').segments.find(
        (segment) => segment.id === 'current',
      ).reserved,
      false,
    );
  });
});

test('hidden road segments stay out of totals until the exact saved segment is activated', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const hiddenGroup = 'road-group:hidden-road';
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
      },
      {
        filename,
        imported: importedTerritory([
          importedSegment('hidden-a', 'Hidden Road', 'service', 4, 'hidden', hiddenGroup),
          importedSegment('hidden-b', 'Hidden Road', 'service', 5, 'hidden', hiddenGroup),
        ]),
      },
    );

    const hidden = getTerritoryWorkspace(filename);
    assert.deepEqual(
      hidden.segments.map((segment) => ({
        id: segment.id,
        activationKind: segment.activationKind,
        active: segment.active,
        eligible: segment.eligible,
      })),
      [
        { id: 'hidden-a', activationKind: 'hidden', active: false, eligible: false },
        { id: 'hidden-b', activationKind: 'hidden', active: false, eligible: false },
      ],
    );
    assert.deepEqual(hidden.totals, {
      allSegments: 0,
      eligibleSegments: 0,
      allHomes: 0,
      eligibleHomes: 0,
    });

    saveTerritoryDraft(
      {
        originAddress: hidden.originAddress,
        center: hidden.center,
        radiusMiles: hidden.radiusMiles,
        boundaryShape: hidden.boundaryShape,
        activatedSegmentIds: ['hidden-a'],
      },
      { filename },
    );

    const activated = getTerritoryWorkspace(filename);
    assert.deepEqual(
      activated.segments.map(({ id, activationKind, active, eligible }) => ({
        id,
        activationKind,
        active,
        eligible,
      })),
      [
        { id: 'hidden-a', activationKind: 'manual', active: true, eligible: true },
        { id: 'hidden-b', activationKind: 'hidden', active: false, eligible: false },
      ],
    );
    assert.deepEqual(activated.totals, {
      allSegments: 1,
      eligibleSegments: 1,
      allHomes: 4,
      eligibleHomes: 4,
    });
  });
});

test('saving a segment exclusion persists only the exact selected segment', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const sharedGroup = 'road-group:shared';
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: [],
      },
      {
        filename,
        imported: importedTerritory([
          importedSegment('one', 'Shared Road', 'residential', 4, 'automatic', sharedGroup),
          importedSegment('two', 'Shared Road', 'residential', 5, 'automatic', sharedGroup),
        ]),
      },
    );

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: ['one'],
      },
      { filename },
    );

    const saved = getTerritoryWorkspace(filename);
    assert.deepEqual(
      saved.segments.map(({ id, manuallyExcluded, eligible, excludedReason }) => ({
        id,
        manuallyExcluded,
        eligible,
        excludedReason,
      })),
      [
        { id: 'one', manuallyExcluded: true, eligible: false, excludedReason: 'segment' },
        { id: 'two', manuallyExcluded: false, eligible: true, excludedReason: null },
      ],
    );
    assert.deepEqual(saved.totals, {
      allSegments: 2,
      eligibleSegments: 1,
      allHomes: 9,
      eligibleHomes: 5,
    });
  });
});

test('reimport preserves an exclusion only while the exact segment geometry remains', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const original = importedSegment('one', 'Exact Road', 'residential', 4);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: [],
      },
      { filename, imported: importedTerritory([original]) },
    );
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: ['one'],
      },
      { filename },
    );

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: ['one'],
      },
      {
        filename,
        imported: importedTerritory([{ ...original, estimatedHomes: 5, activationKind: 'hidden' }]),
      },
    );
    const hidden = getTerritoryWorkspace(filename).segments[0];
    assert.equal(hidden.manuallyExcluded, true);
    assert.equal(hidden.active, false);

    const changedGeometry = {
      ...original,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.1169, 33.5429],
          [-117.1167, 33.5431],
        ],
      },
    };
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: ['one'],
      },
      { filename, imported: importedTerritory([changedGeometry]) },
    );

    const replacement = getTerritoryWorkspace(filename).segments[0];
    assert.equal(replacement.manuallyExcluded, false);
    assert.equal(replacement.eligible, true);
    assert.equal(replacement.excludedReason, null);
  });
});

test('reimport keeps an administrator-approved source active when its group identity changes', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const originalGroup = 'road-group:original';
    const replacementGroup = 'road-group:replacement';
    const firstImport = importedTerritory([
      importedSegment('candidate', 'Candidate Road', 'service', 7, 'hidden', originalGroup),
    ]);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: ['candidate'],
      },
      { filename, imported: firstImport },
    );
    assert.equal(getTerritoryWorkspace(filename).segments[0].activationKind, 'manual');

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: ['candidate'],
      },
      {
        filename,
        imported: importedTerritory([
          importedSegment('candidate', 'Candidate Road', 'service', 8, 'hidden', replacementGroup),
        ]),
      },
    );

    const reimported = getTerritoryWorkspace(filename).segments;
    assert.deepEqual(
      reimported.map(({ roadGroupId, activationKind, estimatedHomes }) => ({
        roadGroupId,
        activationKind,
        estimatedHomes,
      })),
      [{ roadGroupId: replacementGroup, activationKind: 'manual', estimatedHomes: 8 }],
    );
  });
});

test('reimport preserves the last approved geometry when Overture drops its source road', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const approvedGroup = 'road-group:approved';
    const approved = importedSegment(
      'approved',
      'Approved Road',
      'service',
      6,
      'hidden',
      approvedGroup,
    );
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [approved.id],
      },
      { filename, imported: importedTerritory([approved]) },
    );

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [approved.id],
      },
      {
        filename,
        imported: importedTerritory([importedSegment('new-road', 'New Road', 'residential', 3)]),
      },
    );

    const reimported = getTerritoryWorkspace(filename).segments;
    assert.deepEqual(
      reimported.map(({ id, streetName, activationKind, estimatedHomes }) => ({
        id,
        streetName,
        activationKind,
        estimatedHomes,
      })),
      [
        {
          id: 'approved',
          streetName: 'Approved Road',
          activationKind: 'manual',
          estimatedHomes: 6,
        },
        {
          id: 'new-road',
          streetName: 'New Road',
          activationKind: 'automatic',
          estimatedHomes: 3,
        },
      ],
    );
  });
});

test('reimport preserves coverage and finalized packet references to retired segments', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      {
        filename,
        imported: importedTerritory([
          importedSegment('one', 'Old Residential Road', 'residential', 8),
          importedSegment('two', 'Removed Road', 'residential', 4),
        ]),
      },
    );

    const database = openDatabase(filename);
    const oldSegmentId = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get('church-temecula-pilot', 'territory-temecula-pilot', 'one').id;
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'coverage-reimport-regression',
        'church-temecula-pilot',
        oldSegmentId,
        '2026-07-26',
        'completed',
      );
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'batch-reimport-regression',
        'church-temecula-pilot',
        'Finalized batch',
        'finalized',
        '2026-07-26T12:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'packet-reimport-regression',
        'church-temecula-pilot',
        'batch-reimport-regression',
        'FINAL-001',
        '1 Old Residential Road',
        8,
        'active',
      );
    database
      .prepare(
        `INSERT INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
        VALUES (?, ?, ?, ?)`,
      )
      .run('church-temecula-pilot', 'packet-reimport-regression', oldSegmentId, 0);
    database.close();

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
      },
      {
        filename,
        imported: {
          ...importedTerritory([
            importedSegment('one', 'Updated Residential Road', 'residential', 9),
            importedSegment('three', 'New Road', 'living_street', 5),
          ]),
          completedAt: '2026-07-27T13:00:00.000Z',
        },
      },
    );

    const saved = getTerritoryWorkspace(filename);
    const summary = getFoundationSummary(filename);
    assert.deepEqual(
      saved.segments.map(({ id, streetName, estimatedHomes }) => ({
        id,
        streetName,
        estimatedHomes,
      })),
      [
        { id: 'three', streetName: 'New Road', estimatedHomes: 5 },
        { id: 'one', streetName: 'Updated Residential Road', estimatedHomes: 9 },
      ],
    );
    assert.equal(summary.segmentCount, 2);
    assert.equal(summary.estimatedHomes, 14);

    const reloaded = openDatabase(filename);
    const coverage = reloaded
      .prepare(
        `SELECT ce.street_segment_id, s.import_segment_id, s.is_current
        FROM coverage_events ce
        JOIN street_segments s ON s.id = ce.street_segment_id
        WHERE ce.id = ?`,
      )
      .get('coverage-reimport-regression');
    const packet = reloaded
      .prepare(
        `SELECT ps.street_segment_id, s.import_segment_id, s.is_current
        FROM packet_segments ps
        JOIN street_segments s ON s.id = ps.street_segment_id
        WHERE ps.packet_id = ?`,
      )
      .get('packet-reimport-regression');
    const current = reloaded
      .prepare(
        `SELECT id, import_segment_id, is_current
        FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get('church-temecula-pilot', 'territory-temecula-pilot', 'one');
    assert.deepEqual(
      { ...coverage },
      { street_segment_id: oldSegmentId, import_segment_id: 'one', is_current: 0 },
    );
    assert.deepEqual(
      { ...packet },
      { street_segment_id: oldSegmentId, import_segment_id: 'one', is_current: 0 },
    );
    assert.notEqual(current.id, oldSegmentId);
    assert.equal(current.is_current, 1);
    reloaded.close();
  });
});

test('a replacement failure preserves the complete saved workspace', () => {
  withDatabase((filename) => {
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
        imported: importedTerritory([importedSegment('prior', 'Prior Road', 'residential', 4)]),
      },
    );
    const before = getTerritoryWorkspace(filename);
    assert.deepEqual(before.import.quality, importedTerritory([]).quality);
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
            imported: importedTerritory([
              importedSegment('duplicate', 'A Street', 'residential', 1),
              importedSegment('duplicate', 'B Street', 'residential', 1),
            ]),
          },
        ),
      /UNIQUE constraint failed/,
    );

    assert.deepEqual(getTerritoryWorkspace(filename), before);
  });
});

test('coverage events are append-only and only valid same-segment completed roots can be corrected', () => {
  withDatabase((filename) => {
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

test('coverage boundary appends corrections, retains retired logical history, and totals eligible homes once', () => {
  withDatabase((filename) => {
    const before = getTerritoryWorkspace(filename);
    const first = before.segments.find((segment) => segment.eligible);
    const second = before.segments.find((segment) => segment.eligible && segment.id !== first.id);
    const root = recordCoverageCompletion(first.id, '2026-07-01', filename);
    const otherRoot = recordCoverageCompletion(second.id, '2026-06-01', filename);
    appendCoverageCorrection(root, '2026-07-20', filename);
    appendCoverageCorrection(otherRoot, null, filename);
    const afterVoid = openDatabase(filename);
    const afterVoidCount = afterVoid
      .prepare('SELECT COUNT(*) AS count FROM coverage_events')
      .get().count;
    afterVoid.close();
    assert.throws(
      () => appendCoverageCorrection(otherRoot, null, filename),
      /Coverage event is already void/,
    );
    const afterSecondVoid = openDatabase(filename);
    assert.equal(
      afterSecondVoid.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count,
      afterVoidCount,
    );
    afterSecondVoid.close();
    appendCoverageCorrection(otherRoot, '2026-07-25', filename);
    const packets = openDatabase(filename);
    packets
      .prepare('INSERT INTO batches (id, church_id, name, status) VALUES (?, ?, ?, ?)')
      .run('coverage-batch', 'church-temecula-pilot', 'Coverage batch', 'finalized');
    packets
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'coverage-packet',
        'church-temecula-pilot',
        'coverage-batch',
        'COVERAGE-001',
        '1 Main St',
        1,
        'active',
      );
    packets.close();

    const workspace = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(workspace.activePackets, 1);
    assert.equal(workspace.totals.eligibleHomes, before.totals.eligibleHomes);
    assert.equal(
      workspace.segments.find((segment) => segment.id === first.id).lastCoveredOn,
      '2026-07-20',
    );
    assert.equal(
      workspace.segments.find((segment) => segment.id === second.id).lastCoveredOn,
      '2026-07-25',
    );
    assert.equal(
      workspace.segments.find((segment) => segment.id === first.id).roots[0].corrections.length,
      1,
    );

    const countDatabase = openDatabase(filename);
    const count = countDatabase
      .prepare('SELECT COUNT(*) AS count FROM coverage_events')
      .get().count;
    countDatabase.close();
    assert.throws(
      () => appendCoverageCorrection('missing', '2026-07-26', filename),
      /Coverage event not found/,
    );
    assert.throws(
      () => appendCoverageCorrection(root, '2099-01-01', filename),
      /Invalid coverage date/,
    );
    const afterFailures = openDatabase(filename);
    assert.equal(
      afterFailures.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count,
      count,
    );
    afterFailures.close();

    saveTerritoryDraft(
      {
        originAddress: before.originAddress,
        center: before.center,
        radiusMiles: before.radiusMiles,
        boundaryShape: before.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: [first.id],
      },
      { filename },
    );
    const excluded = getCoverageWorkspace(filename, '2026-07-28').segments.find(
      (segment) => segment.id === first.id,
    );
    assert.equal(excluded?.eligible, false);
    assert.equal(excluded?.excludedReason, 'segment');
    assert.equal(excluded?.roots[0].eventId, root);

    saveTerritoryDraft(
      {
        originAddress: before.originAddress,
        center: before.center,
        radiusMiles: before.radiusMiles,
        boundaryShape: before.boundaryShape,
        activatedSegmentIds: before.segments
          .filter((segment) => segment.activationKind === 'manual')
          .map((segment) => segment.id),
        excludedSegmentIds: before.segments
          .filter((segment) => segment.manuallyExcluded)
          .map((segment) => segment.id),
      },
      {
        filename,
        imported: importedTerritory([
          importedSegment(first.id, 'Replacement Road', 'residential', 9),
        ]),
      },
    );
    const reimported = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(reimported.segments[0].id, first.id);
    assert.equal(reimported.segments[0].lastCoveredOn, '2026-07-20');
  });
});

test('coverage thresholds persist per territory without changing coverage totals', () => {
  withDatabase((filename) => {
    const before = getCoverageWorkspace(filename, '2026-07-28');
    assert.deepEqual(before.thresholds, {
      yellowAfterDays: 90,
      orangeAfterDays: 180,
      redAfterDays: 365,
    });
    assert.equal(before.dataMode, 'canonical');
    const segment = before.segments.find((candidate) => candidate.eligible);
    assert.ok(segment);
    recordCoverageCompletion(segment.id, '2026-05-29', filename);
    const beforeThresholdChange = getCoverageWorkspace(filename, '2026-07-28');
    assert.equal(
      beforeThresholdChange.segments.find((candidate) => candidate.id === segment.id).coverageClass,
      'green',
    );
    const coveredHomes = countEligibleHomesCovered(
      beforeThresholdChange.segments,
      beforeThresholdChange.asOf,
      90,
    );

    saveCoverageThresholds(
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 },
      filename,
    );
    const after = getCoverageWorkspace(filename, '2026-07-28');
    assert.deepEqual(after.thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
    assert.deepEqual(
      after.legend.map(({ label }) => label),
      ['0-29 days', '30-59 days', '60-89 days', '90+ days or never', 'Excluded'],
    );
    assert.equal(
      after.segments.find((candidate) => candidate.id === segment.id).coverageClass,
      'orange',
    );
    assert.equal(after.totals.eligibleHomes, before.totals.eligibleHomes);
    assert.equal(countEligibleHomesCovered(after.segments, after.asOf, 90), coveredHomes);

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

test('coverage demo recreates only its isolated database with stable representative review data', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-demo-'));
  const filename = path.join(directory, 'coverage-demo.db');
  const asOf = '2026-07-28';
  try {
    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    assert.throws(
      () => seedCoverageDemo(path.join(directory, 'not-the-demo.db'), asOf),
      /must be named coverage-demo\.db/,
    );
    seedCoverageDemo(filename, asOf);
    const first = openDatabase(filename);
    const firstCounts = ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
      (table) => first.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    );
    first.close();

    const workspace = withTemeculaWorkspace(() => getCoverageWorkspace(filename, asOf));
    assert.equal(workspace.dataMode, 'demo');
    assert.deepEqual(
      [...new Set(workspace.segments.map((segment) => segment.coverageClass))].sort(),
      ['green', 'orange', 'red', 'yellow'],
    );
    assert.equal(
      workspace.segments.filter((segment) => segment.lastCoveredOn === null).length >= 2,
      true,
    );
    assert.equal(workspace.activePackets, 1);
    assert.deepEqual(
      [30, 90, 180, 365].map((period) =>
        countEligibleHomesCovered(workspace.segments, workspace.asOf, period),
      ),
      [5, 21, 27, 28],
    );
    const corrected = workspace.segments
      .flatMap((segment) => segment.roots)
      .find((root) => root.eventId === 'coverage-demo-corrected-root');
    const voided = workspace.segments
      .flatMap((segment) => segment.roots)
      .find((root) => root.eventId === 'coverage-demo-voided-root');
    assert.deepEqual(corrected, {
      eventId: 'coverage-demo-corrected-root',
      packetId: null,
      originalCoveredOn: '2025-03-15',
      effectiveCoveredOn: '2026-07-08',
      corrections: [
        {
          id: 'coverage-demo-corrected-date',
          sequence: 6,
          coveredOn: '2026-07-08',
          isVoid: false,
        },
      ],
    });
    assert.deepEqual(
      voided?.corrections.map(({ id, coveredOn, isVoid }) => ({ id, coveredOn, isVoid })),
      [{ id: 'coverage-demo-voided-undo', coveredOn: '2025-03-15', isVoid: true }],
    );
    assert.equal(voided?.effectiveCoveredOn, null);

    seedCoverageDemo(filename, asOf);
    const second = openDatabase(filename);
    assert.deepEqual(
      ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
        (table) => second.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
      firstCounts,
    );
    second.close();

    const founderFilename = path.join(directory, 'streetlight.db');
    const founder = openDatabase(founderFilename);
    migrateDatabase(founder);
    seedDatabase(founder);
    assert.deepEqual(
      ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
        (table) => founder.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
      [0, 0, 0, 0],
    );
    founder.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo can copy the full empty-history territory into geographic age bands', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-full-coverage-demo-'));
  const sourceFilename = path.join(directory, 'streetlight.db');
  const demoFilename = path.join(directory, 'coverage-demo.db');
  const asOf = '2026-07-28';
  try {
    const source = openDatabase(sourceFilename);
    migrateDatabase(source);
    seedDatabase(source);
    source.prepare('UPDATE territories SET name = ?').run('Full territory source');
    source.close();
    const sourceBefore = readFileSync(sourceFilename);

    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    seedCoverageDemo(demoFilename, asOf, sourceFilename);

    assert.deepEqual(readFileSync(sourceFilename), sourceBefore);
    const demo = openDatabase(demoFilename);
    const copiedName = demo.prepare('SELECT name FROM territories').get().name;
    const eventCount = demo.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count;
    const unlinkedDemoEvents = demo
      .prepare(
        `SELECT COUNT(*) AS count FROM coverage_events
        WHERE id LIKE 'coverage-demo-band-%' AND packet_id IS NULL`,
      )
      .get().count;
    demo.close();
    assert.equal(copiedName, 'Full territory source');
    assert.equal(eventCount > 20, true);
    assert.equal(unlinkedDemoEvents, 0);

    const workspace = withTemeculaWorkspace(() => getCoverageWorkspace(demoFilename, asOf));
    assert.equal(workspace.dataMode, 'demo');
    assert.deepEqual(
      [...new Set(workspace.segments.map((segment) => segment.coverageClass))].sort(),
      ['green', 'orange', 'red', 'yellow'],
    );
    assert.equal(
      workspace.segments.some((segment) => segment.lastCoveredOn === null),
      true,
    );
    assert.deepEqual(
      [
        ...new Set(
          workspace.segments
            .map((segment) => segment.lastCoveredOn)
            .filter((coveredOn) => coveredOn !== null),
        ),
      ].sort(),
      ['2025-03-15', '2025-11-30', '2026-03-30', '2026-06-28'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo preserves source history and adds bands only to untouched streets', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-covered-demo-source-'));
  const sourceFilename = path.join(directory, 'streetlight.db');
  const demoFilename = path.join(directory, 'coverage-demo.db');
  try {
    const source = openDatabase(sourceFilename);
    migrateDatabase(source);
    seedDatabase(source);
    const segment = source.prepare('SELECT id FROM street_segments ORDER BY id LIMIT 1').get();
    source
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('real-history', 'church-temecula-pilot', segment.id, '2026-07-01', 'completed', null, 0);
    source.close();
    const sourceBefore = readFileSync(sourceFilename);

    const { seedCoverageDemo } = await import('./seed-coverage-demo.mjs');
    seedCoverageDemo(demoFilename, '2026-07-28', sourceFilename);

    assert.deepEqual(readFileSync(sourceFilename), sourceBefore);
    const demo = openDatabase(demoFilename);
    assert.equal(
      demo.prepare('SELECT COUNT(*) AS count FROM coverage_events').get().count > 1,
      true,
    );
    assert.equal(
      demo
        .prepare('SELECT COUNT(*) AS count FROM coverage_events WHERE street_segment_id = ?')
        .get(segment.id).count,
      1,
    );
    demo.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage demo CLI seeds an explicit guarded path and preserves a rejected target', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-demo-cli-'));
  const filename = path.join(directory, 'coverage-demo.db');
  const rejected = path.join(directory, 'not-the-demo.db');
  const command = path.join(import.meta.dirname, 'seed-coverage-demo.mjs');
  try {
    for (let run = 0; run < 2; run += 1) {
      const result = spawnSync(process.execPath, [command, filename], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const database = openDatabase(filename);
      assert.deepEqual(
        ['coverage_events', 'batches', 'packets', 'packet_segments'].map(
          (table) => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ),
        [8, 1, 1, 1],
      );
      database.close();
    }

    writeFileSync(rejected, 'do not delete');
    const result = spawnSync(process.execPath, [command, rejected], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be named coverage-demo\.db/);
    assert.equal(readFileSync(rejected, 'utf8'), 'do not delete');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
