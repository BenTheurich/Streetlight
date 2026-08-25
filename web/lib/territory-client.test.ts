import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateSegments,
  apartmentSiteReady,
  apartmentSiteSummary,
  deriveTerritory,
  setSegmentsExcluded,
  territoryDraftFromWorkspace,
  territoryMapMode,
  withApartmentSiteConfiguration,
} from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import type { TerritorySegment, TerritoryWorkspace } from './territory-workspace.ts';

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

const workspace: TerritoryWorkspace = {
  id: 'territory',
  churchName: 'Church',
  name: 'Region',
  originAddress: '1 Main Street',
  center: [0, 0],
  radiusMiles: 1,
  boundaryShape: 'circle',
  import: {
    kind: 'proof',
    release: null,
    center: null,
    radiusMiles: null,
    completedAt: null,
    normalizerVersion: null,
    quality: null,
  },
  apartmentSites: [
    {
      id: 'apartment',
      sourceId: 'source',
      name: null,
      address: '1 Main Street',
      position: [0, 0],
      boundary: null,
      groupingKind: 'ungrouped',
      groupingConfirmed: false,
      addressConfirmed: false,
      tractCount: null,
      accessStatus: 'unknown',
      includedInPackets: false,
      packetReady: false,
      members: [
        {
          id: 'building-one',
          sourceId: 'source',
          address: '1 Main Street',
          position: [0, 0],
          geometry: null,
          apartmentBuilding: true,
          distinctUnits: 0,
        },
      ],
      estimatedTracts: 12,
      evidence: { apartmentBuilding: true, distinctUnits: 12 },
      reviewStatus: 'needs_review',
      withinBoundary: true,
    },
  ],
  apartmentComplexes: [],
  segments: [],
  totals: { allSegments: 0, eligibleSegments: 0, allHomes: 0, eligibleHomes: 0 },
};

test('apartment inclusion needs address, tract quantity, and access', () => {
  const complete = {
    address: '10 Main Street',
    tractCount: 24,
    accessStatus: 'open' as const,
  };
  assert.equal(apartmentSiteReady(complete), true);
  assert.equal(apartmentSiteReady({ ...complete, address: null }), false);
  assert.equal(apartmentSiteReady({ ...complete, tractCount: null }), false);
  assert.equal(apartmentSiteReady({ ...complete, accessStatus: 'unknown' }), false);
});

test('apartment summary reports sites and inclusion only', () => {
  assert.deepEqual(apartmentSiteSummary(workspace.apartmentSites), {
    siteCount: 1,
    includedCount: 0,
  });
  assert.deepEqual(
    apartmentSiteSummary([{ ...workspace.apartmentSites[0], includedInPackets: true }]),
    { siteCount: 1, includedCount: 1 },
  );
});

test('apartment configuration updates the matching site and alias', () => {
  const configured = withApartmentSiteConfiguration(workspace, {
    ...workspace.apartmentSites[0],
    groupingConfirmed: true,
    packetReady: true,
    includedInPackets: true,
  });
  assert.equal(workspace.apartmentSites[0].groupingConfirmed, false);
  assert.equal(configured.apartmentSites[0].includedInPackets, true);
  assert.equal(configured.apartmentComplexes[0].includedInPackets, true);
  assert.equal('apartmentStatuses' in territoryDraftFromWorkspace(workspace), false);
});

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

test('setup keeps the region map visible while editing only in the Region view', () => {
  assert.deepEqual(territoryMapMode('setup', 'territory'), {
    visible: true,
    interactive: true,
  });
  assert.deepEqual(territoryMapMode('setup', 'printouts'), {
    visible: true,
    interactive: false,
  });
  assert.deepEqual(territoryMapMode('coverage', 'territory'), {
    visible: false,
    interactive: false,
  });
});
