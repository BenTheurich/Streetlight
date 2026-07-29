import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { getTerritoryWorkspace, saveTerritoryDraft } from './database.ts';
import { parseTerritoryDraft } from './territory-draft.ts';
import type { LineString, Polygon } from './territory-geometry.ts';

function polygonAround(line: LineString, padding = 0.00001): Polygon {
  const longitudes = line.coordinates.map(([longitude]) => longitude);
  const latitudes = line.coordinates.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes) - padding;
  const east = Math.max(...longitudes) + padding;
  const south = Math.min(...latitudes) - padding;
  const north = Math.max(...latitudes) + padding;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

function withDatabase(run: (filename: string) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-territory-'));
  const filename = path.join(directory, 'streetlight.db');
  try {
    const database = openDatabase(filename);
    migrateDatabase(database);
    seedDatabase(database);
    database.close();
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a persisted exclusion enabled state controls derived totals', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    assert.equal(initial.segments.length, 55);
    assert.equal(initial.totals.allHomes, 427);
    const selected = initial.segments.find((segment) => segment.estimatedHomes > 0);
    assert.ok(selected);
    const geometry = polygonAround(selected.geometry);

    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: 20,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: [{ id: 'exclude-school', name: 'School', enabled: false, geometry }],
      },
      { filename },
    );

    const disabled = getTerritoryWorkspace(filename);
    assert.equal(disabled.radiusMiles, 20);
    assert.deepEqual(disabled.exclusions, [
      { id: 'exclude-school', name: 'School', enabled: false, geometry },
    ]);
    assert.equal(
      disabled.segments.find((segment) => segment.id === selected.id)?.excludedReason,
      null,
    );

    saveTerritoryDraft(
      {
        originAddress: disabled.originAddress,
        center: disabled.center,
        radiusMiles: disabled.radiusMiles,
        boundaryShape: disabled.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: [{ ...disabled.exclusions[0], enabled: true }],
      },
      { filename },
    );

    const enabled = getTerritoryWorkspace(filename);
    assert.equal(
      enabled.segments.find((segment) => segment.id === selected.id)?.excludedReason,
      'exclusion',
    );
    assert.equal(
      enabled.totals.eligibleHomes,
      enabled.segments
        .filter((segment) => segment.eligible)
        .reduce((total, segment) => total + segment.estimatedHomes, 0),
    );
  });
});

test('saving a deletion removes only the omitted exclusion', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const geometry = polygonAround(initial.segments[0].geometry);
    const keep = { id: 'keep', name: 'Keep', enabled: true, geometry };
    const remove = { id: 'remove', name: 'Remove', enabled: true, geometry };

    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: initial.radiusMiles,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: [keep, remove],
      },
      { filename },
    );
    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: initial.radiusMiles,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: [keep],
      },
      { filename },
    );

    assert.deepEqual(getTerritoryWorkspace(filename).exclusions, [keep]);
  });
});

test('changing the church point keeps saved exclusion coordinates unchanged', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const geometry = polygonAround(initial.segments[0].geometry);

    saveTerritoryDraft(
      {
        originAddress: '1 New Address, Temecula, CA',
        center: [-117.2, 33.6],
        radiusMiles: 5,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: [{ id: 'exclude-existing', name: 'Existing', enabled: true, geometry }],
      },
      { filename },
    );

    const saved = getTerritoryWorkspace(filename);
    assert.equal(saved.originAddress, '1 New Address, Temecula, CA');
    assert.deepEqual(saved.center, [-117.2, 33.6]);
    assert.deepEqual(saved.exclusions[0].geometry, geometry);
  });
});

test('a failed complete-draft save rolls back territory and exclusions together', () => {
  withDatabase((filename) => {
    const initial = getTerritoryWorkspace(filename);
    const geometry = polygonAround(initial.segments[0].geometry);

    assert.throws(() =>
      saveTerritoryDraft(
        {
          originAddress: 'Rollback Address',
          center: [-117.2, 33.6],
          radiusMiles: 1,
          boundaryShape: initial.boundaryShape,
          activatedRoadGroupIds: [],
          excludedSegmentIds: [],
          exclusions: [
            { id: 'duplicate', name: 'First', enabled: true, geometry },
            { id: 'duplicate', name: 'Second', enabled: true, geometry },
          ],
        },
        { filename },
      ),
    );

    const after = getTerritoryWorkspace(filename);
    assert.equal(after.originAddress, initial.originAddress);
    assert.deepEqual(after.center, initial.center);
    assert.equal(after.radiusMiles, initial.radiusMiles);
    assert.deepEqual(after.exclusions, initial.exclusions);
  });
});

test('draft validation accepts the complete saved-draft contract', () => {
  const parsed = parseTerritoryDraft({
    originAddress: ' 31087 Nicolas Rd ',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    boundaryShape: 'square',
    activatedRoadGroupIds: [' road-group:approved '],
    excludedSegmentIds: [' segment:exact '],
    exclusions: [
      {
        id: 'exclude-1',
        name: '',
        enabled: false,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-117.12, 33.54],
              [-117.11, 33.54],
              [-117.11, 33.55],
              [-117.12, 33.54],
            ],
          ],
        },
      },
    ],
  });

  assert.equal(parsed.originAddress, '31087 Nicolas Rd');
  assert.equal(parsed.boundaryShape, 'square');
  assert.deepEqual(parsed.activatedRoadGroupIds, ['road-group:approved']);
  assert.deepEqual(parsed.excludedSegmentIds, ['segment:exact']);
  assert.equal(parsed.exclusions[0].name, '');
  assert.equal(parsed.exclusions[0].enabled, false);
});

test('draft validation rejects invalid radius, duplicate IDs, and self-intersections', () => {
  const valid = {
    originAddress: '31087 Nicolas Rd',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    boundaryShape: 'circle',
    activatedRoadGroupIds: [],
    excludedSegmentIds: [],
    exclusions: [
      {
        id: 'exclude-1',
        name: 'Area',
        enabled: true,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, -1],
            ],
          ],
        },
      },
    ],
  };

  assert.throws(() => parseTerritoryDraft({ ...valid, radiusMiles: 0 }), /distance/i);
  assert.throws(() => parseTerritoryDraft({ ...valid, boundaryShape: 'triangle' }), /shape/i);
  assert.throws(
    () =>
      parseTerritoryDraft({
        ...valid,
        activatedRoadGroupIds: ['road-group:duplicate', 'road-group:duplicate'],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      parseTerritoryDraft({
        ...valid,
        excludedSegmentIds: ['segment:duplicate', 'segment:duplicate'],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      parseTerritoryDraft({
        ...valid,
        exclusions: [{ ...valid.exclusions[0], enabled: 'yes' }],
      }),
    /enabled/i,
  );
  assert.throws(
    () =>
      parseTerritoryDraft({
        ...valid,
        exclusions: [valid.exclusions[0], valid.exclusions[0]],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      parseTerritoryDraft({
        ...valid,
        exclusions: [
          {
            ...valid.exclusions[0],
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-1, -1],
                  [1, 1],
                  [-1, 1],
                  [1, -1],
                  [-1, -1],
                ],
              ],
            },
          },
        ],
      }),
    /intersect/i,
  );
});
