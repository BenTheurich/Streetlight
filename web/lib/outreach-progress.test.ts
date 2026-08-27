import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageWorkspace } from './coverage.ts';
import {
  buildOutreachProgress,
  outreachProgressPlayback,
  outreachProgressSnapshot,
  outreachProgressStepCount,
  outreachProgressYears,
} from './outreach-progress.ts';

const root = (eventId: string, date: string | null, packetId: string | null) => ({
  eventId,
  packetId,
  originalCoveredOn: date ?? '2026-01-01',
  effectiveCoveredOn: date,
  corrections: [],
});

const workspace = {
  asOf: '2026-08-02',
  segments: [
    {
      id: 'street-a',
      estimatedHomes: 12,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117, 33],
          [-117.1, 33.1],
        ],
      },
      roots: [root('event-a', '2026-02-01', 'packet-a')],
    },
    {
      id: 'street-b',
      estimatedHomes: 8,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117, 33],
          [-117.2, 33.2],
        ],
      },
      roots: [root('event-b', '2026-03-01', 'packet-a'), root('void', null, null)],
    },
  ],
  apartmentComplexes: [
    {
      id: 'apartment-a',
      position: [-117, 33],
      estimatedTracts: 20,
      roots: [root('event-c', '2025-12-01', 'packet-c')],
    },
  ],
} as unknown as CoverageWorkspace;

test('progress periods use corrected effective dates and keep years deterministic', () => {
  assert.deepEqual(outreachProgressYears(workspace), [2026, 2025]);
  assert.deepEqual(buildOutreachProgress(workspace, 2026).dates, ['2026-02-01', '2026-03-01']);
});

test('cumulative snapshots never remove earlier outreach', () => {
  const progress = buildOutreachProgress(workspace, 2026);
  assert.deepEqual(outreachProgressSnapshot(progress, '2026-02-01'), {
    completedPackets: 1,
    streetSections: 1,
    apartmentComplexes: 0,
    estimatedHomes: 12,
    outreachDays: 1,
  });
  assert.deepEqual(outreachProgressSnapshot(progress, '2026-03-01'), {
    completedPackets: 1,
    streetSections: 2,
    apartmentComplexes: 0,
    estimatedHomes: 20,
    outreachDays: 2,
  });
});

test('playback advances only through recorded outreach days', () => {
  const progress = buildOutreachProgress(workspace, 2026);

  assert.equal(outreachProgressStepCount(progress), 2);
  assert.deepEqual(outreachProgressPlayback(progress, 0.1), {
    barPosition: 0.5,
    completedStep: 0,
    revealDate: '2026-02-01',
    revealProgress: 0,
    selectedDate: null,
    through: null,
  });
  assert.deepEqual(outreachProgressPlayback(progress, 0.5), {
    barPosition: 1,
    completedStep: 0,
    revealDate: '2026-02-01',
    revealProgress: 0.5,
    selectedDate: '2026-02-01',
    through: null,
  });
  assert.deepEqual(outreachProgressPlayback(progress, 0.9), {
    barPosition: 1,
    completedStep: 1,
    revealDate: '2026-02-01',
    revealProgress: 1,
    selectedDate: '2026-02-01',
    through: '2026-02-01',
  });
});

test('rolling progress spans the latest 52 weeks across calendar years', () => {
  const progress = buildOutreachProgress(workspace, 'rolling');

  assert.equal(progress.mode, 'rolling');
  assert.equal(progress.startDate, '2025-08-04');
  assert.equal(progress.endDate, '2026-08-02');
  assert.equal(outreachProgressStepCount(progress), 3);
  assert.deepEqual(progress.dates, ['2025-12-01', '2026-02-01', '2026-03-01']);
});
