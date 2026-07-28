import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarDateInTimeZone,
  classifyCoverage,
  countEligibleHomesCovered,
  coverageLegend,
  DEFAULT_COVERAGE_THRESHOLDS,
  deriveCoverageSegments,
  parseCorrectionRequest,
  parseCoverageThresholds,
  validateCoverageDate,
} from './coverage.ts';

const asOf = '2026-07-28';

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
    [
      'Green: 0-89 days',
      'Yellow: 90-179 days',
      'Orange: 180-364 days',
      'Red: 365+ days or never',
      'Excluded',
    ],
  );
});

test('heatmap legend derives every label from custom transitions', () => {
  assert.deepEqual(
    coverageLegend({ yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 }).map(
      ({ label }) => label,
    ),
    [
      'Green: 0-29 days',
      'Yellow: 30-59 days',
      'Orange: 60-89 days',
      'Red: 90+ days or never',
      'Excluded',
    ],
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

test('derivation retains root history, isolates roots, and supports correction void and restore', () => {
  const [segment] = deriveCoverageSegments(
    [
      {
        id: 'completed-old',
        segmentId: 'segment-1',
        sequence: 1,
        coveredOn: '2025-01-01',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
      {
        id: 'completed-new',
        segmentId: 'segment-1',
        sequence: 2,
        coveredOn: '2026-06-01',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
      {
        id: 'old-correction',
        segmentId: 'segment-1',
        sequence: 3,
        coveredOn: '2026-07-01',
        kind: 'correction',
        correctsEventId: 'completed-old',
        isVoid: false,
      },
      {
        id: 'new-void',
        segmentId: 'segment-1',
        sequence: 4,
        coveredOn: '2026-06-01',
        kind: 'correction',
        correctsEventId: 'completed-new',
        isVoid: true,
      },
      {
        id: 'new-restore',
        segmentId: 'segment-1',
        sequence: 5,
        coveredOn: '2026-07-20',
        kind: 'correction',
        correctsEventId: 'completed-new',
        isVoid: false,
      },
    ],
    asOf,
  );

  assert.equal(segment.lastCoveredOn, '2026-07-20');
  assert.deepEqual(segment.roots, [
    {
      eventId: 'completed-old',
      originalCoveredOn: '2025-01-01',
      effectiveCoveredOn: '2026-07-01',
      corrections: [
        {
          id: 'old-correction',
          sequence: 3,
          coveredOn: '2026-07-01',
          isVoid: false,
        },
      ],
    },
    {
      eventId: 'completed-new',
      originalCoveredOn: '2026-06-01',
      effectiveCoveredOn: '2026-07-20',
      corrections: [
        { id: 'new-void', sequence: 4, coveredOn: '2026-06-01', isVoid: true },
        { id: 'new-restore', sequence: 5, coveredOn: '2026-07-20', isVoid: false },
      ],
    },
  ]);
});

test('eligible period homes include each covered logical segment once at inclusive endpoints', () => {
  const derived = deriveCoverageSegments(
    [
      {
        id: 'a',
        segmentId: 'a',
        sequence: 1,
        coveredOn: '2026-04-30',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
      {
        id: 'b',
        segmentId: 'b',
        sequence: 2,
        coveredOn: '2026-07-28',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
      {
        id: 'a-again',
        segmentId: 'a',
        sequence: 3,
        coveredOn: '2026-05-15',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
      {
        id: 'c',
        segmentId: 'c',
        sequence: 4,
        coveredOn: '2026-04-29',
        kind: 'completed',
        correctsEventId: null,
        isVoid: false,
      },
    ],
    asOf,
    [
      { id: 'a', estimatedHomes: 3, eligible: true },
      { id: 'b', estimatedHomes: 5, eligible: true },
      { id: 'c', estimatedHomes: 7, eligible: true },
      { id: 'd', estimatedHomes: 11, eligible: false },
    ],
  );
  assert.equal(countEligibleHomesCovered(derived, asOf, 90), 8);
  assert.equal(
    countEligibleHomesCovered(
      [{ ...derived[0], lastCoveredOn: '2026-07-29', estimatedHomes: 13 }],
      asOf,
      90,
    ),
    0,
  );
});
