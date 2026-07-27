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
  getTerritoryWorkspace,
  recordCoverageCompletion,
  saveTerritoryDraft,
} from '../lib/database.ts';
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
    run(filename);
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
    activationKind,
  };
}

function importedTerritory(segments) {
  return {
    release: '2026-06-17.0',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 4,
    quality: {
      totalAddresses: 12,
      assignedAddresses: 10,
      inferredRoads: 1,
      unmatchedAddresses: 2,
      unresolvedClusters: 0,
    },
    segments,
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
      'ignore_zones',
    ];

    const emptyTables = new Set([
      'coverage_events',
      'batches',
      'packets',
      'packet_segments',
      'ignore_zones',
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
    const workspace = getTerritoryWorkspace(filename);
    const summary = getFoundationSummary(filename);
    assert.equal(workspace.import.kind, 'proof');
    assert.equal(workspace.import.release, null);
    assert.equal(workspace.import.normalizerVersion, null);
    assert.equal(workspace.import.quality, null);
    assert.equal(summary.packetCount, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('circle and square boundary shapes persist and control whole-segment eligibility', () => {
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
      activatedRoadGroupIds: [],
      excludedSegmentIds: [],
      exclusions: [],
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

    saveTerritoryDraft({ ...baseDraft, boundaryShape: 'square' }, { filename });
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
  });
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

test('exclusion rows default to enabled and reject invalid states', () => {
  withDatabase((filename) => {
    const database = openDatabase(filename);
    try {
      database
        .prepare(
          `INSERT INTO ignore_zones
            (id, church_id, territory_id, name, geometry_geojson)
          VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          'default-enabled',
          'church-temecula-pilot',
          'territory-temecula-pilot',
          'Default enabled',
          '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[0,0]]]}',
        );
      assert.equal(
        database.prepare('SELECT enabled FROM ignore_zones WHERE id = ?').get('default-enabled')
          .enabled,
        1,
      );
      database.prepare('UPDATE ignore_zones SET enabled = 0 WHERE id = ?').run('default-enabled');
      assert.throws(
        () =>
          database
            .prepare('UPDATE ignore_zones SET enabled = 2 WHERE id = ?')
            .run('default-enabled'),
        /CHECK constraint failed/,
      );
    } finally {
      database.close();
    }
  });
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
        exclusions: workspace.exclusions,
      },
      { filename, imported },
    );

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
          ...imported.segments[1],
          active: true,
          eligible: true,
          excludedReason: null,
        },
        {
          ...imported.segments[0],
          active: true,
          eligible: true,
          excludedReason: null,
        },
      ],
    );
  });
});

test('hidden road groups stay out of totals until the saved draft activates them', () => {
  withDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const hiddenGroup = 'road-group:hidden-road';
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: hidden.exclusions,
        activatedRoadGroupIds: [hiddenGroup],
      },
      { filename },
    );

    const activated = getTerritoryWorkspace(filename);
    assert.equal(
      activated.segments.every((segment) => segment.activationKind === 'manual'),
      true,
    );
    assert.equal(
      activated.segments.every((segment) => segment.active && segment.eligible),
      true,
    );
    assert.deepEqual(activated.totals, {
      allSegments: 2,
      eligibleSegments: 2,
      allHomes: 9,
      eligibleHomes: 9,
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [],
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
        exclusions: [],
        activatedRoadGroupIds: [originalGroup],
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
        exclusions: [],
        activatedRoadGroupIds: [originalGroup],
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
        exclusions: [],
        activatedRoadGroupIds: [approvedGroup],
      },
      { filename, imported: importedTerritory([approved]) },
    );

    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        exclusions: [],
        activatedRoadGroupIds: [approvedGroup],
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
        exclusions: workspace.exclusions,
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
        exclusions: workspace.exclusions,
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
        exclusions: initial.exclusions,
      },
      {
        filename,
        imported: importedTerritory([importedSegment('prior', 'Prior Road', 'residential', 4)]),
      },
    );
    const before = getTerritoryWorkspace(filename);
    assert.deepEqual(before.import.quality, {
      totalAddresses: 12,
      assignedAddresses: 10,
      inferredRoads: 1,
      unmatchedAddresses: 2,
      unresolvedClusters: 0,
    });
    assert.throws(
      () =>
        saveTerritoryDraft(
          {
            originAddress: 'Rollback Address',
            center: [-117.2, 33.6],
            radiusMiles: 5,
            boundaryShape: 'circle',
            exclusions: [
              {
                id: 'rollback-exclusion',
                name: 'Rollback exclusion',
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-117.21, 33.59],
                      [-117.19, 33.59],
                      [-117.19, 33.61],
                      [-117.21, 33.59],
                    ],
                  ],
                },
              },
            ],
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
      () => appendCoverageCorrection(root, '2026-07-29', filename),
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
        exclusions: before.exclusions,
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

    const workspace = getCoverageWorkspace(filename, asOf);
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
