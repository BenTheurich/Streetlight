import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageWorkspace } from './database.ts';
import {
  buildOutreachProgress,
  outreachProgressSnapshot,
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
