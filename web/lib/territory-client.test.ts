import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerritorySegment, TerritoryWorkspace } from './database.ts';
import * as territoryClient from './territory-client.ts';
import {
  affectedByExclusion,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  moveVertexWithArrowKey,
  nextExclusionName,
  territoryDraftFromWorkspace,
} from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import type { Position } from './territory-geometry.ts';

const segments: TerritorySegment[] = [
  {
    id: 'inside',
    sourceSegmentId: 'inside',
    roadGroupId: 'road-group:inside',
    roadClass: 'residential',
    streetName: 'Inside Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0, 0.005],
      ],
    },
    estimatedHomes: 10,
    activationKind: 'automatic',
    active: true,
    manuallyExcluded: false,
    eligible: true,
    excludedReason: null,
  },
  {
    id: 'outside',
    sourceSegmentId: 'outside',
    roadGroupId: 'road-group:outside',
    roadClass: 'residential',
    streetName: 'Outside Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0.03],
        [0, 0.04],
      ],
    },
    estimatedHomes: 20,
    activationKind: 'automatic',
    active: true,
    manuallyExcluded: false,
    eligible: true,
    excludedReason: null,
  },
  {
    id: 'touched',
    sourceSegmentId: 'touched',
    roadGroupId: 'road-group:touched',
    roadClass: 'residential',
    streetName: 'Touched Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.005, 0],
        [0.005, 0.005],
      ],
    },
    estimatedHomes: 5,
    activationKind: 'automatic',
    active: true,
    manuallyExcluded: false,
    eligible: true,
    excludedReason: null,
  },
  {
    id: 'hidden',
    sourceSegmentId: 'hidden',
    roadGroupId: 'road-group:hidden',
    roadClass: 'service',
    streetName: 'Hidden Road',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.001, 0],
        [0.001, 0.005],
      ],
    },
    estimatedHomes: 7,
    activationKind: 'hidden',
    active: false,
    manuallyExcluded: false,
    eligible: false,
    excludedReason: 'hidden',
  },
];

const draft: TerritoryDraftInput = {
  originAddress: 'Church',
  center: [0, 0],
  radiusMiles: 1,
  activatedRoadGroupIds: [],
  excludedSegmentIds: [],
  exclusions: [
    {
      id: 'exclude-1',
      name: 'Park',
      enabled: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.004, -0.001],
            [0.006, -0.001],
            [0.006, 0.006],
            [0.004, 0.006],
            [0.004, -0.001],
          ],
        ],
      },
    },
  ],
};

test('live territory derivation distinguishes radius and polygon exclusions', () => {
  const result = deriveTerritory(segments, draft);

  assert.deepEqual(
    result.segments.map(({ id, eligible, excludedReason }) => ({
      id,
      eligible,
      excludedReason,
    })),
    [
      { id: 'inside', eligible: true, excludedReason: null },
      { id: 'outside', eligible: false, excludedReason: 'radius' },
      { id: 'touched', eligible: false, excludedReason: 'exclusion' },
      { id: 'hidden', eligible: false, excludedReason: 'hidden' },
    ],
  );
  assert.deepEqual(result.totals, {
    allSegments: 3,
    eligibleSegments: 1,
    allHomes: 35,
    eligibleHomes: 10,
  });
});

test('a disabled exclusion reports its potential impact without changing eligibility', () => {
  const result = deriveTerritory(segments, {
    ...draft,
    exclusions: [{ ...draft.exclusions[0], enabled: false }],
  });

  assert.deepEqual(
    result.segments
      .filter((segment) => segment.id === 'touched')
      .map(({ eligible, excludedReason }) => ({ eligible, excludedReason })),
    [{ eligible: true, excludedReason: null }],
  );
  assert.deepEqual(result.totals, {
    allSegments: 3,
    eligibleSegments: 2,
    allHomes: 35,
    eligibleHomes: 15,
  });
  assert.deepEqual(
    affectedByExclusion(segments, {
      ...draft.exclusions[0],
      enabled: false,
    }),
    {
      segments: 1,
      homes: 5,
    },
  );
});

test('a draft road-group activation includes every hidden segment in that group', () => {
  const result = deriveTerritory(segments, {
    ...draft,
    activatedRoadGroupIds: ['road-group:hidden'],
  });

  assert.deepEqual(
    result.segments
      .filter((segment) => segment.roadGroupId === 'road-group:hidden')
      .map(({ active, eligible, activationKind, excludedReason }) => ({
        active,
        eligible,
        activationKind,
        excludedReason,
      })),
    [{ active: true, eligible: true, activationKind: 'manual', excludedReason: null }],
  );
  assert.deepEqual(result.totals, {
    allSegments: 4,
    eligibleSegments: 2,
    allHomes: 42,
    eligibleHomes: 17,
  });
});

test('a manual segment exclusion affects only the exact selected segment', () => {
  const adjacentSegment: TerritorySegment = {
    ...segments[0],
    id: 'inside-adjacent',
    sourceSegmentId: 'inside-adjacent',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0.005],
        [0, 0.009],
      ],
    },
    estimatedHomes: 4,
  };
  const result = deriveTerritory([segments[0], adjacentSegment], {
    ...draft,
    excludedSegmentIds: ['inside'],
    exclusions: [],
  });

  assert.deepEqual(
    result.segments.map(({ id, manuallyExcluded, eligible, excludedReason }) => ({
      id,
      manuallyExcluded,
      eligible,
      excludedReason,
    })),
    [
      {
        id: 'inside',
        manuallyExcluded: true,
        eligible: false,
        excludedReason: 'segment',
      },
      {
        id: 'inside-adjacent',
        manuallyExcluded: false,
        eligible: true,
        excludedReason: null,
      },
    ],
  );
  assert.deepEqual(result.totals, {
    allSegments: 2,
    eligibleSegments: 1,
    allHomes: 14,
    eligibleHomes: 4,
  });
});

test('exclusion impact counts every segment touched by that polygon', () => {
  assert.deepEqual(affectedByExclusion(segments, draft.exclusions[0]), {
    segments: 1,
    homes: 5,
  });
});

test('workspace conversion keeps only the complete editable draft', () => {
  const workspace: TerritoryWorkspace = {
    id: 'territory',
    churchName: 'Church',
    name: 'Territory',
    ...draft,
    import: {
      kind: 'proof',
      release: null,
      center: null,
      radiusMiles: null,
      completedAt: null,
      normalizerVersion: null,
      quality: null,
    },
    segments,
    totals: {
      allSegments: 3,
      eligibleSegments: 3,
      allHomes: 35,
      eligibleHomes: 35,
    },
  };

  assert.deepEqual(territoryDraftFromWorkspace(workspace), draft);
});

test('default exclusion names skip names that already exist', () => {
  assert.equal(
    nextExclusionName([
      { ...draft.exclusions[0], name: 'Excluded area 1' },
      { ...draft.exclusions[0], id: 'exclude-3', name: 'Excluded area 3' },
    ]),
    'Excluded area 2',
  );
});

test('arrow keys move only the focused polygon vertex by a deterministic step', () => {
  const points: Position[] = [
    [10, 20],
    [30, 40],
  ];

  assert.deepEqual(moveVertexWithArrowKey(points, 1, 'ArrowUp'), [
    [10, 20],
    [30, 40.00005],
  ]);
  assert.deepEqual(moveVertexWithArrowKey(points, 1, 'ArrowDown'), [
    [10, 20],
    [30, 39.99995],
  ]);
  assert.deepEqual(moveVertexWithArrowKey(points, 1, 'ArrowLeft'), [
    [10, 20],
    [29.99995, 40],
  ]);
  assert.deepEqual(moveVertexWithArrowKey(points, 1, 'ArrowRight'), [
    [10, 20],
    [30.00005, 40],
  ]);
  assert.deepEqual(points, [
    [10, 20],
    [30, 40],
  ]);
});

test('unfinished drawing points count as unsaved territory changes', () => {
  assert.equal(hasUnsavedTerritoryChanges(draft, structuredClone(draft), []), false);
  assert.equal(hasUnsavedTerritoryChanges(draft, structuredClone(draft), [[0, 0]]), true);
  assert.equal(
    hasUnsavedTerritoryChanges(draft, { ...structuredClone(draft), radiusMiles: 2 }, []),
    true,
  );
});

test('segment exclusion draft changes are exact, reversible, and duplicate-safe', () => {
  const update = (
    territoryClient as typeof territoryClient & {
      setSegmentExcluded?: (
        draft: TerritoryDraftInput,
        segmentId: string,
        excluded: boolean,
      ) => TerritoryDraftInput;
    }
  ).setSegmentExcluded;
  assert.equal(typeof update, 'function');
  assert.ok(update);

  const withOtherExcluded = { ...draft, excludedSegmentIds: ['other'] };
  const excluded = update(withOtherExcluded, 'inside', true);
  assert.deepEqual(excluded.excludedSegmentIds, ['inside', 'other']);
  assert.deepEqual(update(excluded, 'inside', true).excludedSegmentIds, ['inside', 'other']);
  assert.deepEqual(update(excluded, 'inside', false).excludedSegmentIds, ['other']);
  assert.deepEqual(withOtherExcluded.excludedSegmentIds, ['other']);
});
