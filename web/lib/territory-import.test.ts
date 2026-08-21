import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTerritoryImport, planTerritoryImport } from './territory-import.ts';

const draft = {
  originAddress: '31087 Nicolas Rd, Temecula, CA 92591',
  center: [-117.1274, 33.5107] as [number, number],
  radiusMiles: 1,
  boundaryShape: 'circle' as const,
  activatedRoadGroupIds: [],
  excludedSegmentIds: [],
  exclusions: [],
};
const quality = {
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
        normalizerVersion: 10,
        quality,
      },
      draft,
    ),
    true,
  );
});

test('shape changes, exclusions, and radius reductions reuse a current footprint', () => {
  assert.equal(
    needsTerritoryImport(
      {
        kind: 'overture',
        release: '2026-06-17.0',
        center: draft.center,
        radiusMiles: 2,
        completedAt: '2026-07-27T12:00:00.000Z',
        normalizerVersion: 10,
        quality,
      },
      {
        ...draft,
        boundaryShape: 'square',
        exclusions: [
          {
            id: 'x',
            name: '',
            enabled: true,
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
        normalizerVersion: 10,
        quality,
      },
      draft,
    ),
    true,
  );
});

test('shifted drafts reuse only containing imported footprints', () => {
  const imported = {
    kind: 'overture' as const,
    release: '2026-06-17.0',
    center: draft.center,
    radiusMiles: 2,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 10,
    quality,
  };

  assert.equal(
    needsTerritoryImport(imported, {
      ...draft,
      center: [draft.center[0] + 0.001, draft.center[1]],
    }),
    false,
  );
  assert.equal(
    needsTerritoryImport(imported, {
      ...draft,
      center: [draft.center[0] + 0.001, draft.center[1]],
      radiusMiles: 2,
    }),
    true,
  );
  assert.equal(
    needsTerritoryImport(
      { ...imported, radiusMiles: 1 },
      {
        ...draft,
        center: [draft.center[0] + 1e-12, draft.center[1] - 1e-12],
      },
    ),
    false,
  );
});

test('legacy and mismatched normalizer versions require replacement', () => {
  const current = {
    kind: 'overture' as const,
    release: '2026-06-17.0',
    center: draft.center,
    radiusMiles: 2,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 10,
    quality,
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
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 2 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 3 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 4 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 5 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 6 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 7 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 8 }, draft), true);
  assert.equal(needsTerritoryImport({ ...current, normalizerVersion: 9 }, draft), true);
  assert.equal(needsTerritoryImport(current, draft), false);
});

test('plans only newly added strips for a centered expansion', () => {
  const plan = planTerritoryImport(
    {
      kind: 'overture',
      release: '2026-06-17.0',
      center: draft.center,
      radiusMiles: 1,
      completedAt: '2026-07-27T12:00:00.000Z',
      normalizerVersion: 10,
      quality,
    },
    { ...draft, radiusMiles: 2 },
  );

  assert.equal(plan.kind, 'incremental');
  assert.equal(plan.kind === 'incremental' ? plan.bounds.length : 0, 4);
});

test('plans one new strip for an overlapping same-size recenter', () => {
  const imported = {
    kind: 'overture' as const,
    release: '2026-06-17.0',
    center: draft.center,
    radiusMiles: 1,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 10,
    quality,
  };
  const plan = planTerritoryImport(imported, {
    ...draft,
    center: [draft.center[0] + 0.005, draft.center[1]],
  });

  assert.equal(plan.kind, 'incremental');
  assert.equal(plan.kind === 'incremental' ? plan.bounds.length : 0, 1);
});

test('plans no import for a contained shrink and a full import for a disjoint recenter', () => {
  const imported = {
    kind: 'overture' as const,
    release: '2026-06-17.0',
    center: draft.center,
    radiusMiles: 2,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 10,
    quality,
  };

  assert.deepEqual(planTerritoryImport(imported, draft), { kind: 'none' });
  assert.deepEqual(planTerritoryImport(imported, { ...draft, center: [-110, 40] }), {
    kind: 'full',
  });
});
