import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerritorySegment } from './database.ts';
import {
  affectedByExclusion,
  deriveTerritory,
  nextExclusionName,
  territoryDraftFromWorkspace,
} from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';

const segments: TerritorySegment[] = [
  {
    id: 'inside',
    sourceSegmentId: 'inside',
    streetName: 'Inside Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0, 0.005],
      ],
    },
    estimatedHomes: 10,
    eligible: true,
    excludedReason: null,
  },
  {
    id: 'outside',
    sourceSegmentId: 'outside',
    streetName: 'Outside Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0.03],
        [0, 0.04],
      ],
    },
    estimatedHomes: 20,
    eligible: true,
    excludedReason: null,
  },
  {
    id: 'touched',
    sourceSegmentId: 'touched',
    streetName: 'Touched Street',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.005, 0],
        [0.005, 0.005],
      ],
    },
    estimatedHomes: 5,
    eligible: true,
    excludedReason: null,
  },
];

const draft: TerritoryDraftInput = {
  originAddress: 'Church',
  center: [0, 0],
  radiusMiles: 1,
  exclusions: [
    {
      id: 'exclude-1',
      name: 'Park',
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
    ],
  );
  assert.deepEqual(result.totals, {
    allSegments: 3,
    eligibleSegments: 1,
    allHomes: 35,
    eligibleHomes: 10,
  });
});

test('exclusion impact counts every segment touched by that polygon', () => {
  assert.deepEqual(affectedByExclusion(segments, draft.exclusions[0]), {
    segments: 1,
    homes: 5,
  });
});

test('workspace conversion keeps only the complete editable draft', () => {
  const workspace = {
    id: 'territory',
    churchName: 'Church',
    name: 'Territory',
    ...draft,
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
