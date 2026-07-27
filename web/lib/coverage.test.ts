import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCoverage,
  countEligibleHomesCovered,
  deriveCoverageSegments,
  parseCorrectionRequest,
  validateCoverageDate,
} from './coverage.ts';

const asOf = '2026-07-28';

test('coverage classes use every inclusive age boundary and never-covered is red', () => {
  assert.deepEqual(
    ['2026-04-30', '2026-04-29', '2026-01-30', '2026-01-29', '2025-07-30', '2025-07-28', null].map(
      (coveredOn) => classifyCoverage(coveredOn, asOf),
    ),
    ['green', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red'],
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
        id: 'c',
        segmentId: 'c',
        sequence: 3,
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
});
