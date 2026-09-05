import assert from 'node:assert/strict';
import test from 'node:test';
import * as coverageModule from './coverage.ts';
import {
  calendarDateInTimeZone,
  classifyCoverage,
  countEligibleHomesByCoverageClass,
  coverageLegend,
  DEFAULT_COVERAGE_THRESHOLDS,
  parseCorrectionRequest,
  parseCoverageThresholds,
  validateCoverageDate,
} from './coverage.ts';

const asOf = '2026-07-28';

function searchableSegment(id: string, roadGroupId: string, streetName: string) {
  return {
    id,
    roadGroupId,
    streetName,
    estimatedHomes: 1,
    lastCoveredOn: null,
    eligible: true,
    coverageClass: 'red' as const,
  };
}

test('calendar dates follow the church time zone around UTC midnight', () => {
  assert.equal(
    calendarDateInTimeZone(new Date('2026-07-29T00:30:00Z'), 'America/Los_Angeles'),
    '2026-07-28',
  );
  assert.equal(
    calendarDateInTimeZone(new Date('2026-07-29T07:30:00Z'), 'America/Los_Angeles'),
    '2026-07-29',
  );
});

test('coverage classes use every inclusive age boundary and never-covered is red', () => {
  assert.deepEqual(
    [
      '2026-04-30',
      '2026-04-29',
      '2026-01-30',
      '2026-01-29',
      '2025-07-30',
      '2025-07-29',
      '2025-07-28',
      null,
    ].map((coveredOn) => classifyCoverage(coveredOn, asOf)),
    ['green', 'yellow', 'yellow', 'orange', 'orange', 'orange', 'red', 'red'],
  );
});

test('custom heatmap transitions classify exact boundary days and keep never-covered red', () => {
  const thresholds = { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 };
  assert.deepEqual(
    ['2026-06-29', '2026-06-28', '2026-05-30', '2026-05-29', '2026-04-30', '2026-04-29', null].map(
      (coveredOn) => classifyCoverage(coveredOn, asOf, thresholds),
    ),
    ['green', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red'],
  );
});

test('heatmap range requests require exactly three ascending bounded integers', () => {
  const valid = { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 };
  assert.deepEqual(parseCoverageThresholds(valid), valid);
  for (const request of [
    { yellowAfterDays: 0, orangeAfterDays: 60, redAfterDays: 90 },
    { yellowAfterDays: 60, orangeAfterDays: 60, redAfterDays: 90 },
    { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 3651 },
    { yellowAfterDays: 30.5, orangeAfterDays: 60, redAfterDays: 90 },
    { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90, extra: true },
  ]) {
    assert.throws(() => parseCoverageThresholds(request), /heatmap ranges/i);
  }
});

test('heatmap legend explains the complete default outreach-age ranges', () => {
  assert.deepEqual(
    coverageLegend(DEFAULT_COVERAGE_THRESHOLDS).map(({ label }) => label),
    ['0-89 days', '90-179 days', '180-364 days', '365+ days or never', 'Excluded'],
  );
});

test('heatmap legend derives every label from custom transitions', () => {
  assert.deepEqual(
    coverageLegend({ yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 }).map(
      ({ label }) => label,
    ),
    ['0-29 days', '30-59 days', '60-89 days', '90+ days or never', 'Excluded'],
  );
});

test('coverage distribution counts eligible estimated homes in each heatmap class', () => {
  assert.deepEqual(
    countEligibleHomesByCoverageClass([
      { coverageClass: 'green', eligible: true, estimatedHomes: 8 },
      { coverageClass: 'yellow', eligible: true, estimatedHomes: 13 },
      { coverageClass: 'orange', eligible: true, estimatedHomes: 21 },
      { coverageClass: 'red', eligible: true, estimatedHomes: 34 },
      { coverageClass: 'red', eligible: false, estimatedHomes: 55 },
    ]),
    { green: 8, yellow: 13, orange: 21, red: 34 },
  );
});

test('street search trims case, keeps human name order, and returns one connected road group', () => {
  const search = coverageModule.searchCoverageRoads;
  assert.equal(typeof search, 'function');
  const segments = [
    searchableSegment('internal-z', 'road-z', 'Zinnia Road'),
    searchableSegment('internal-oak-1', 'road-oak', ' Oak Street '),
    searchableSegment('internal-oak-2', 'road-oak', 'oak street'),
    searchableSegment('internal-a', 'road-a', 'Acacia Road'),
  ];

  assert.deepEqual(
    search?.(segments, '  OAK  ').matches.map(({ roadGroupId }) => roadGroupId),
    ['road-oak'],
  );
  assert.deepEqual(
    search?.(segments, 'road').matches.map(({ roadGroupId }) => roadGroupId),
    ['road-a', 'road-z'],
  );
});

test('street search keeps unnamed roads reachable and caps visible road groups at twenty', () => {
  const search = coverageModule.searchCoverageRoads;
  assert.equal(typeof search, 'function');
  const unnamed = searchableSegment('internal-unnamed', 'road-unnamed', '  ');

  assert.equal(search?.([unnamed], 'unnamed').matches[0]?.segments[0], unnamed);
  assert.deepEqual(search?.([unnamed], '   '), { matches: [], total: 0, hasMore: false });

  const matches = Array.from({ length: 22 }, (_, index) =>
    searchableSegment(`internal-${index}`, `road-${index}`, 'Main Street'),
  );
  const result = search?.(matches, 'main');
  assert.equal(result?.matches.length, 20);
  assert.equal(result?.total, 22);
  assert.equal(result?.hasMore, true);
  assert.equal(result?.matches.at(-1)?.roadGroupId, 'road-19');
});

test('street search announcements cover blank, empty, singular, and capped live results', () => {
  const announce = coverageModule.coverageSearchAnnouncement;
  assert.equal(announce('', { total: 0, hasMore: false }), null);
  assert.equal(announce(' Oak ', { total: 0, hasMore: false }), 'No streets match “Oak”.');
  assert.equal(announce('Oak', { total: 1, hasMore: false }), '1 matching road.');
  assert.equal(announce('Oak', { total: 2, hasMore: false }), '2 matching roads.');
  assert.equal(
    announce('Oak', { total: 22, hasMore: true }),
    'Showing 20 of 22 roads. Refine your search to narrow the list.',
  );
});

test('street search merges nearby same-name carriageways but keeps distant namesakes separate', () => {
  const segment = (id: string, roadGroupId: string, coordinates: Array<[number, number]>) => ({
    ...searchableSegment(id, roadGroupId, 'Winchester Road'),
    geometry: { coordinates },
  });
  const roads = coverageModule.searchCoverageRoads(
    [
      segment('northbound', 'road-northbound', [
        [-117.1437, 33.5427],
        [-117.1405, 33.5526],
      ]),
      segment('southbound', 'road-southbound', [
        [-117.1435, 33.5427],
        [-117.1403, 33.5526],
      ]),
      segment('distant', 'road-distant', [
        [-117.13, 33.54],
        [-117.129, 33.55],
      ]),
    ],
    'winchester',
  ).matches;

  assert.deepEqual(
    roads.map(({ segments }) => segments.map(({ id }) => id)),
    [['northbound', 'southbound'], ['distant']],
  );
  assert.deepEqual(
    coverageModule
      .coverageRoadForSegment(
        roads.flatMap(({ segments }) => segments),
        'southbound',
      )
      ?.segments.map(({ id }) => id),
    ['northbound', 'southbound'],
  );
});

test('coverage road result aggregates sections without exposing internal IDs', () => {
  const content = coverageModule.coverageRoadResultContent;
  assert.equal(typeof content, 'function');
  const result = content?.({
    roadGroupId: 'road-secret-hash',
    streetName: 'Oak Street',
    segments: [
      {
        ...searchableSegment('segment-secret-hash', 'road-secret-hash', 'Oak Street'),
        estimatedHomes: 17,
        eligible: false,
      },
      {
        ...searchableSegment('segment-second-hash', 'road-secret-hash', 'Oak Street'),
        estimatedHomes: 5,
        lastCoveredOn: '2026-07-01',
      },
    ],
  });

  assert.deepEqual(result, {
    streetName: 'Oak Street',
    sections: 2,
    estimatedTracts: 22,
    lastOutreach: 'mixed',
    eligibility: '1 of 2 sections eligible',
  });
  assert.doesNotMatch(JSON.stringify(result), /segment-secret-hash/);
});

test('road coverage rows group current sections by source packet instead of date alone', () => {
  const groups = (
    coverageModule as typeof coverageModule & {
      coverageRoadPacketGroups?: (segments: Array<Record<string, unknown>>) => unknown;
    }
  ).coverageRoadPacketGroups;
  assert.equal(typeof groups, 'function');
  const root = (packetId: string, coveredOn: string) => ({
    eventId: `${packetId}-${coveredOn}`,
    packetId,
    originalCoveredOn: coveredOn,
    effectiveCoveredOn: coveredOn,
    corrections: [],
  });

  assert.deepEqual(
    groups?.([
      {
        id: 'never',
        estimatedHomes: 1,
        lastCoveredOn: null,
        coverageClass: 'red',
        roots: [],
      },
      {
        id: 'packet-a-first',
        estimatedHomes: 2,
        lastCoveredOn: '2025-12-02',
        coverageClass: 'orange',
        roots: [root('packet-a', '2025-12-02')],
      },
      {
        id: 'packet-a-second',
        estimatedHomes: 3,
        lastCoveredOn: '2025-12-02',
        coverageClass: 'orange',
        roots: [root('packet-a', '2025-12-02')],
      },
      {
        id: 'packet-b',
        estimatedHomes: 4,
        lastCoveredOn: '2025-12-02',
        coverageClass: 'orange',
        roots: [root('packet-b', '2025-12-02')],
      },
    ]),
    [
      {
        packetId: null,
        lastCoveredOn: null,
        coverageClass: 'red',
        sections: 1,
        estimatedTracts: 1,
      },
      {
        packetId: 'packet-a',
        lastCoveredOn: '2025-12-02',
        coverageClass: 'orange',
        sections: 2,
        estimatedTracts: 5,
      },
      {
        packetId: 'packet-b',
        lastCoveredOn: '2025-12-02',
        coverageClass: 'orange',
        sections: 1,
        estimatedTracts: 4,
      },
    ],
  );
});
test('current work state follows whether packets await reconciliation', () => {
  const state = coverageModule.currentWorkState;
  assert.equal(typeof state, 'function');
  assert.equal(state?.(3), 'active');
  assert.equal(state?.(0), 'ready');
});

test('coverage selection starts empty and clears when a selected street disappears', () => {
  const retain = coverageModule.retainCoverageSelection;
  assert.equal(typeof retain, 'function');
  const segments = [{ id: 'segment-a' }, { id: 'segment-b' }];

  assert.equal(retain?.(null, segments), null);
  assert.equal(retain?.('segment-b', segments), 'segment-b');
  assert.equal(retain?.('segment-old', segments), null);
});

test('coverage labels move to the next free row when their anchors would overlap', () => {
  assert.deepEqual(
    coverageModule.stackCoverageLabelRows?.([
      { positionPercent: 10, gapPercent: 12 },
      { positionPercent: 17, gapPercent: 12 },
      { positionPercent: 30, gapPercent: 12 },
      { positionPercent: 82, gapPercent: 12 },
      { positionPercent: 100, gapPercent: 25 },
    ]),
    [0, 1, 0, 0, 1],
  );
});

test('date validation accepts real past UTC dates and rejects impossible or future dates', () => {
  assert.equal(validateCoverageDate('2024-02-29', asOf), '2024-02-29');
  for (const value of [
    '2026-02-29',
    '2026-1-01',
    '2026-01-1',
    '2026-01-01T00:00:00Z',
    '2026-07-29',
  ]) {
    assert.throws(() => validateCoverageDate(value, asOf), /coverage date/i);
  }
});

test('correction requests accept exactly eventId and coveredOn', () => {
  assert.deepEqual(parseCorrectionRequest({ eventId: 'event-1', coveredOn: null }, asOf), {
    eventId: 'event-1',
    coveredOn: null,
  });
  for (const request of [
    { eventId: 'event-1' },
    { eventId: 'event-1', coveredOn: '2026-07-01', segmentId: 'segment-1' },
    { eventId: 'event-1', coveredOn: '2026-07-01', kind: 'completed' },
    { eventId: '', coveredOn: '2026-07-01' },
  ]) {
    assert.throws(() => parseCorrectionRequest(request, asOf), /correction request/i);
  }
});
