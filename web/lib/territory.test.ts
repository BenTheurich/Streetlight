import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
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
    run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a complete territory draft persists radius, exclusions, and derived totals', () => {
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
        exclusions: [{ id: 'exclude-school', name: 'School', geometry }],
      },
      { filename },
    );

    const saved = getTerritoryWorkspace(filename);
    assert.equal(saved.radiusMiles, 20);
    assert.deepEqual(saved.exclusions, [{ id: 'exclude-school', name: 'School', geometry }]);
    assert.equal(
      saved.segments.find((segment) => segment.id === selected.id)?.excludedReason,
      'exclusion',
    );
    assert.equal(
      saved.totals.eligibleHomes,
      saved.segments
        .filter((segment) => segment.eligible)
        .reduce((total, segment) => total + segment.estimatedHomes, 0),
    );
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
        exclusions: [{ id: 'exclude-existing', name: 'Existing', geometry }],
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
          exclusions: [
            { id: 'duplicate', name: 'First', geometry },
            { id: 'duplicate', name: 'Second', geometry },
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
    exclusions: [
      {
        id: 'exclude-1',
        name: '',
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
  assert.equal(parsed.exclusions[0].name, '');
});

test('draft validation rejects invalid radius, duplicate IDs, and self-intersections', () => {
  const valid = {
    originAddress: '31087 Nicolas Rd',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    exclusions: [
      {
        id: 'exclude-1',
        name: 'Area',
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

  assert.throws(() => parseTerritoryDraft({ ...valid, radiusMiles: 0 }), /radius/i);
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
