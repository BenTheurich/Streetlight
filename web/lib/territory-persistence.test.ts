import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/migrate.mjs';
import {
  importedApartmentFixture,
  importedSegmentFixture,
  importedTerritoryFixture,
  withSeededTemeculaDatabase,
} from '../test/persistence-fixtures.ts';
import { TEMECULA_TEST_WORKSPACE } from '../test/workspace-fixtures.ts';
import { getCoverageWorkspace } from './coverage-persistence.ts';
import type { ImportedTerritoryInput, ImportedTerritorySegment } from './overture-import.ts';
import { territoryDraftFromWorkspace } from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
  saveApartmentSiteConfiguration,
  saveTerritoryDraft as saveContainedTerritoryDraft,
} from './territory-persistence.ts';
import { runInWorkspace } from './workspace-scope.ts';

function saveTerritoryDraft(
  draft: unknown,
  options: { filename: string; imported?: ImportedTerritoryInput },
) {
  const parsedDraft = draft as TerritoryDraftInput;
  return options.imported
    ? replaceTerritoryFromImport(parsedDraft, options.imported, { filename: options.filename })
    : saveContainedTerritoryDraft(parsedDraft, { filename: options.filename });
}

for (const kind of ['street', 'apartment'] as const) {
  test(`overlapping churches retain independent ${kind} imports and preserved generations`, () => {
    withSeededTemeculaDatabase((filename) => {
      const initial = getTerritoryWorkspace(filename);
      const secondScope = {
        churchId: 'church-overlapping',
        territoryId: 'territory-overlapping',
        timeZone: TEMECULA_TEST_WORKSPACE.timeZone,
      };
      const database = openDatabase(filename);
      try {
        database
          .prepare('INSERT INTO churches (id, name, time_zone) VALUES (?, ?, ?)')
          .run(secondScope.churchId, 'Overlapping Church', secondScope.timeZone);
        database
          .prepare(
            `INSERT INTO territories
              (id, church_id, name, center_latitude, center_longitude, radius_meters,
                boundary_geojson, origin_address, import_generation)
            SELECT ?, ?, name, center_latitude, center_longitude, radius_meters,
              boundary_geojson, origin_address, import_generation
            FROM territories WHERE id = ?`,
          )
          .run(secondScope.territoryId, secondScope.churchId, initial.id);
      } finally {
        database.close();
      }

      const draft = { ...territoryDraftFromWorkspace(initial), radiusMiles: 1 };
      const segment = importedSegmentFixture('shared-road', 'Shared Road', 'residential', 10);
      const imported = {
        ...importedTerritoryFixture(kind === 'street' ? [segment] : []),
        radiusMiles: 1,
        apartmentSites: kind === 'apartment' ? [importedApartmentFixture('shared-site')] : [],
      };
      for (let generation = 0; generation < 3; generation++) {
        for (const scope of [TEMECULA_TEST_WORKSPACE, secondScope]) {
          runInWorkspace(scope, () => {
            replaceTerritoryFromImport(
              draft,
              generation === 1 ? { ...imported, segments: [], apartmentSites: [] } : imported,
              { filename },
            );
            if (generation === 0) {
              if (kind === 'street') {
                saveContainedTerritoryDraft(
                  { ...draft, activatedSegmentIds: [segment.id] },
                  { filename },
                );
              } else {
                saveApartmentSiteConfiguration(
                  {
                    id: 'shared-site',
                    name: null,
                    address: '10 Sample Road, Temecula CA 92591',
                    addressConfirmed: true,
                    tractCount: 12,
                    accessStatus: 'open',
                    groupingConfirmed: true,
                    includedInPackets: true,
                  },
                  filename,
                );
              }
            }
          });
        }
        for (const scope of [TEMECULA_TEST_WORKSPACE, secondScope]) {
          runInWorkspace(scope, () => {
            const workspace = getTerritoryWorkspace(filename);
            assert.equal(workspace.id, scope.territoryId);
            assert.deepEqual(
              (kind === 'street' ? workspace.segments : workspace.apartmentSites).map(
                ({ id }) => id,
              ),
              [kind === 'street' ? 'shared-road' : 'shared-site'],
            );
          });
        }
      }
    });
  });
}

test('circle and square boundaries control eligibility and coverage-map visibility', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    assert.equal(initial.boundaryShape, 'circle');
    const corner: ImportedTerritorySegment = {
      ...importedSegmentFixture('corner', 'Corner Road', 'residential', 8),
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
      imported: { ...importedTerritoryFixture([corner]), radiusMiles: 1 },
    });
    const circle = getTerritoryWorkspace(filename);
    assert.equal(circle.segments[0]?.withinBoundary, false);
    assert.equal(circle.segments[0]?.excludedReason, 'boundary');
    assert.deepEqual(circle.totals, {
      allSegments: 0,
      eligibleSegments: 0,
      allHomes: 0,
      eligibleHomes: 0,
    });
    assert.deepEqual(getCoverageWorkspace(filename).segments, []);

    saveTerritoryDraft(
      { ...baseDraft, boundaryShape: 'square' },
      {
        filename,
        imported: {
          ...importedTerritoryFixture([
            corner,
            { ...corner, id: 'hidden', streetName: 'Hidden Road', activationKind: 'hidden' },
          ]),
          radiusMiles: 1,
        },
      },
    );
    const square = getTerritoryWorkspace(filename);
    assert.equal(square.boundaryShape, 'square');
    assert.equal(square.segments[0]?.withinBoundary, true);
    assert.equal(square.segments[0]?.eligible, true);
    assert.deepEqual(square.totals, {
      allSegments: 1,
      eligibleSegments: 1,
      allHomes: 8,
      eligibleHomes: 8,
    });
    assert.deepEqual(
      getCoverageWorkspace(filename).segments.map((segment) => segment.id),
      ['corner'],
    );
  });
});

test('an imported save atomically replaces proof segments and records its footprint', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const imported = importedTerritoryFixture([
      importedSegmentFixture('one', 'Residential Road', 'residential', 8),
      importedSegmentFixture('two', 'Calle Medusa', 'tertiary', 3),
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
          geometry_geojson: JSON.stringify(imported.mapBuildings[0]?.geometry),
        },
      );
      assert.equal(
        (
          database
            .prepare(
              `SELECT import_building_mode
              FROM territories WHERE id = 'territory-temecula-pilot'`,
            )
            .get() as { import_building_mode: string }
        ).import_building_mode,
        'overture_fema',
      );
    } finally {
      database.close();
    }
  });
});

test('reimport retains assigned addresses for imported and preserved manual segments', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const approvedGroup = 'road-group:approved';
    const approved: ImportedTerritorySegment = {
      ...importedSegmentFixture('approved', 'Diego Drive', 'service', 6, 'hidden', approvedGroup),
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
      imported: importedTerritoryFixture([approved]),
    });

    const firstDatabase = openDatabase(filename);
    const firstRows = firstDatabase
      .prepare(
        `SELECT s.import_segment_id AS segment_id, s.import_generation,
          a.house_number, a.street, a.locality, a.postcode,
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
          segment_id: 'approved',
          import_generation: 1,
          house_number: '39483',
          street: 'Diego Drive',
          locality: 'Temecula',
          postcode: '92591',
          longitude: -117.1157,
          latitude: 33.5435,
        },
        {
          segment_id: 'approved',
          import_generation: 1,
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
      imported: importedTerritoryFixture([
        importedSegmentFixture('new-road', 'New Road', 'residential', 3),
      ]),
    });

    const secondDatabase = openDatabase(filename);
    const secondRows = secondDatabase
      .prepare(
        `SELECT s.import_segment_id AS segment_id, s.import_generation,
          a.house_number, a.street, a.locality, a.postcode,
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
          segment_id: 'approved',
          import_generation: 2,
          house_number: '39483',
          street: 'Diego Drive',
          locality: 'Temecula',
          postcode: '92591',
          longitude: -117.1157,
          latitude: 33.5435,
        },
        {
          segment_id: 'approved',
          import_generation: 2,
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

test('hidden road segments stay out of totals until the exact saved segment is activated', () => {
  withSeededTemeculaDatabase((filename) => {
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
        imported: importedTerritoryFixture([
          importedSegmentFixture('hidden-a', 'Hidden Road', 'service', 4, 'hidden', hiddenGroup),
          importedSegmentFixture('hidden-b', 'Hidden Road', 'service', 5, 'hidden', hiddenGroup),
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
  withSeededTemeculaDatabase((filename) => {
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
        imported: importedTerritoryFixture([
          importedSegmentFixture('one', 'Shared Road', 'residential', 4, 'automatic', sharedGroup),
          importedSegmentFixture('two', 'Shared Road', 'residential', 5, 'automatic', sharedGroup),
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
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const original = importedSegmentFixture('one', 'Exact Road', 'residential', 4);
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        activatedSegmentIds: [],
        excludedSegmentIds: [],
      },
      { filename, imported: importedTerritoryFixture([original]) },
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
        imported: importedTerritoryFixture([
          { ...original, estimatedHomes: 5, activationKind: 'hidden' },
        ]),
      },
    );
    const hidden = getTerritoryWorkspace(filename).segments[0];
    assert.equal(hidden.manuallyExcluded, true);
    assert.equal(hidden.active, false);

    const changedGeometry: ImportedTerritorySegment = {
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
      { filename, imported: importedTerritoryFixture([changedGeometry]) },
    );

    const replacement = getTerritoryWorkspace(filename).segments[0] as ReturnType<
      typeof getTerritoryWorkspace
    >['segments'][number];
    assert.equal(replacement.manuallyExcluded, false);
    assert.equal(replacement.eligible, true);
    assert.equal(replacement.excludedReason, null);
  });
});

test('reimport keeps an administrator-approved source active when its group identity changes', () => {
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const originalGroup = 'road-group:original';
    const replacementGroup = 'road-group:replacement';
    const firstImport = importedTerritoryFixture([
      importedSegmentFixture('candidate', 'Candidate Road', 'service', 7, 'hidden', originalGroup),
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
    assert.equal(getTerritoryWorkspace(filename).segments[0]?.activationKind, 'manual');

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
        imported: importedTerritoryFixture([
          importedSegmentFixture(
            'candidate',
            'Candidate Road',
            'service',
            8,
            'hidden',
            replacementGroup,
          ),
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
  withSeededTemeculaDatabase((filename) => {
    const workspace = getTerritoryWorkspace(filename);
    const approvedGroup = 'road-group:approved';
    const approved = importedSegmentFixture(
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
      { filename, imported: importedTerritoryFixture([approved]) },
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
        imported: importedTerritoryFixture([
          importedSegmentFixture('new-road', 'New Road', 'residential', 3),
        ]),
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
  withSeededTemeculaDatabase((filename) => {
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
        imported: importedTerritoryFixture([
          importedSegmentFixture('one', 'Old Residential Road', 'residential', 8),
          importedSegmentFixture('two', 'Removed Road', 'residential', 4),
        ]),
      },
    );

    const database = openDatabase(filename);
    const oldSegmentId = (
      database
        .prepare(
          `SELECT id FROM street_segments
          WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
        )
        .get('church-temecula-pilot', 'territory-temecula-pilot', 'one') as { id: string }
    ).id;
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
          ...importedTerritoryFixture([
            importedSegmentFixture('one', 'Updated Residential Road', 'residential', 9),
            importedSegmentFixture('three', 'New Road', 'living_street', 5),
          ]),
          completedAt: '2026-07-27T13:00:00.000Z',
        },
      },
    );

    const saved = getTerritoryWorkspace(filename);
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
    assert.notEqual((current as { id: string }).id, oldSegmentId);
    assert.equal((current as { is_current: number }).is_current, 1);
    reloaded.close();
  });
});

test('exact segment activation persists without activating other hidden segments', () => {
  withSeededTemeculaDatabase((filename) => {
    const seeded = getTerritoryWorkspace(filename);
    const [selected, other] = seeded.segments;
    assert.ok(selected);
    assert.ok(other);
    const database = openDatabase(filename);
    const hide = database.prepare(
      'UPDATE street_segments SET activation_kind = ? WHERE import_segment_id = ?',
    );
    hide.run('hidden', selected.id);
    hide.run('hidden', other.id);
    database.close();
    const initial = getTerritoryWorkspace(filename);
    const draft = territoryDraftFromWorkspace(initial);

    saveTerritoryDraft({ ...draft, activatedSegmentIds: [selected.id] }, { filename });

    const saved = getTerritoryWorkspace(filename);
    assert.equal(saved.segments.find(({ id }) => id === selected.id)?.activationKind, 'manual');
    assert.equal(saved.segments.find(({ id }) => id === selected.id)?.active, true);
    assert.equal(saved.segments.find(({ id }) => id === other.id)?.active, false);
  });
});

test('exact segment exclusion persists without excluding adjacent segments', () => {
  withSeededTemeculaDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const selected = initial.segments.find((segment) => segment.eligible);
    assert.ok(selected);
    const draft = territoryDraftFromWorkspace(initial);

    saveTerritoryDraft({ ...draft, excludedSegmentIds: [selected.id] }, { filename });

    const saved = getTerritoryWorkspace(filename);
    const result = saved.segments.find(({ id }) => id === selected.id);
    assert.equal(result?.manuallyExcluded, true);
    assert.equal(result?.excludedReason, 'segment');
    assert.ok(saved.segments.some((segment) => segment.id !== selected.id && segment.eligible));
  });
});
