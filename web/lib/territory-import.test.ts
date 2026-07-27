import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTerritoryImport } from './territory-import.ts';

const draft = {
  originAddress: '31087 Nicolas Rd, Temecula, CA 92591',
  center: [-117.1274, 33.5107] as [number, number],
  radiusMiles: 1,
  exclusions: [],
};

test('proof data and an expanded footprint require imports', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'proof',
        release: null,
        center: null,
        radiusMiles: null,
        completedAt: null,
        normalizerVersion: null,
        quality: null,
      },
      draft,
    ),
    true,
  );
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: draft.center,
        radiusMiles: 0.5,
        completedAt: '2026-07-27T12:00:00.000Z',
        normalizerVersion: 2,
        quality: {
          totalAddresses: 12,
          assignedAddresses: 10,
          inferredRoads: 1,
          unmatchedAddresses: 2,
        },
      },
      draft,
    ),
    true,
  );
});

test('exclusion changes and radius reductions reuse a current footprint', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: draft.center,
        radiusMiles: 2,
        completedAt: '2026-07-27T12:00:00.000Z',
        normalizerVersion: 2,
        quality: {
          totalAddresses: 12,
          assignedAddresses: 10,
          inferredRoads: 1,
          unmatchedAddresses: 2,
        },
      },
      {
        ...draft,
        exclusions: [
          {
            id: 'x',
            name: '',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-117.13, 33.51],
                  [-117.12, 33.51],
                  [-117.13, 33.51],
                ],
              ],
            },
          },
        ],
      },
    ),
    false,
  );
});

test('a different pinned Overture release requires an import', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-05-20.0',
        center: draft.center,
        radiusMiles: 2,
        completedAt: '2026-07-27T12:00:00.000Z',
        normalizerVersion: 2,
        quality: {
          totalAddresses: 12,
          assignedAddresses: 10,
          inferredRoads: 1,
          unmatchedAddresses: 2,
        },
      },
      draft,
    ),
    true,
  );
});

test('a changed territory center requires an import', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: [-117.1275, 33.5107],
        radiusMiles: 2,
        completedAt: '2026-07-27T12:00:00.000Z',
        normalizerVersion: 2,
        quality: {
          totalAddresses: 12,
          assignedAddresses: 10,
          inferredRoads: 1,
          unmatchedAddresses: 2,
        },
      },
      draft,
    ),
    true,
  );
});

test('legacy and mismatched normalizer versions require replacement', () => {
  const current = {
    kind: 'overture' as const,
    release: '2026-06-17.0',
    center: draft.center,
    radiusMiles: 2,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 2,
    quality: { totalAddresses: 12, assignedAddresses: 10, inferredRoads: 1, unmatchedAddresses: 2 },
  };

  assert.equal(
    needsTerritoryImport({ ...current, normalizerVersion: null, quality: null }, draft),
    true,
  );
  assert.equal(
    needsTerritoryImport({ ...current, quality: undefined } as unknown as typeof current, draft),
    true,
  );
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 1 }, draft), true);
  assert.equal(needsTerritoryImport(current, draft), false);
});
