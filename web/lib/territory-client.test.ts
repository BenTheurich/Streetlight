import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerritorySegment } from './database.ts';
import { activateSegments, deriveTerritory, setSegmentsExcluded } from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';

const visible: TerritorySegment = {
  id: 'visible',
  sourceSegmentId: 'visible',
  roadGroupId: 'road-group:shared',
  roadClass: 'residential',
  streetName: 'Shared Road',
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
  withinBoundary: true,
  manuallyExcluded: false,
  eligible: true,
  excludedReason: null,
};

const hidden: TerritorySegment = {
  ...visible,
  id: 'hidden',
  sourceSegmentId: 'hidden',
  activationKind: 'hidden',
  active: false,
  eligible: false,
  excludedReason: 'hidden',
};

const hiddenAdjacent: TerritorySegment = {
  ...hidden,
  id: 'hidden-adjacent',
  sourceSegmentId: 'hidden-adjacent',
};

const draft: TerritoryDraftInput = {
  originAddress: 'Church',
  center: [0, 0],
  radiusMiles: 1,
  boundaryShape: 'circle',
  activatedSegmentIds: [],
  excludedSegmentIds: [],
  apartmentStatuses: [],
};

test('activation includes only the exact hidden segment selected', () => {
  const result = deriveTerritory(
    [visible, hidden, hiddenAdjacent],
    activateSegments(draft, ['hidden']),
  );

  assert.deepEqual(
    result.segments
      .filter((segment) => segment.roadGroupId === 'road-group:shared')
      .map(({ id, active, eligible, activationKind, excludedReason }) => ({
        id,
        active,
        eligible,
        activationKind,
        excludedReason,
      })),
    [
      {
        id: 'visible',
        active: true,
        eligible: true,
        activationKind: 'automatic',
        excludedReason: null,
      },
      {
        id: 'hidden',
        active: true,
        eligible: true,
        activationKind: 'manual',
        excludedReason: null,
      },
      {
        id: 'hidden-adjacent',
        active: false,
        eligible: false,
        activationKind: 'hidden',
        excludedReason: 'hidden',
      },
    ],
  );
});

test('manual exclusion affects only the exact selected segments', () => {
  const result = deriveTerritory(
    [visible, { ...visible, id: 'adjacent', sourceSegmentId: 'adjacent' }],
    setSegmentsExcluded(draft, ['visible'], true),
  );

  assert.deepEqual(
    result.segments.map(({ id, manuallyExcluded, eligible, excludedReason }) => ({
      id,
      manuallyExcluded,
      eligible,
      excludedReason,
    })),
    [
      { id: 'visible', manuallyExcluded: true, eligible: false, excludedReason: 'segment' },
      { id: 'adjacent', manuallyExcluded: false, eligible: true, excludedReason: null },
    ],
  );
});

test('batch exclusion helpers preserve unrelated selections', () => {
  const excluded = setSegmentsExcluded(
    { ...draft, excludedSegmentIds: ['existing'] },
    ['visible', 'adjacent'],
    true,
  );
  assert.deepEqual(excluded.excludedSegmentIds, ['adjacent', 'existing', 'visible']);
  assert.deepEqual(
    setSegmentsExcluded(excluded, ['visible', 'adjacent'], false).excludedSegmentIds,
    ['existing'],
  );
});
