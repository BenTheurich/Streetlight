import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { insertCoverageCompletionFixture } from '../test/persistence-fixtures.ts';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  saveCoverageThresholds,
} from './coverage-persistence.ts';

function withCoverageDatabase(run: (filename: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-persistence-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();

  try {
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('saving heatmap ranges returns the refreshed coverage workspace', () => {
  withCoverageDatabase((filename) => {
    const workspace = saveCoverageThresholds(
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 },
      filename,
    );

    assert.deepEqual(workspace.thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
    assert.ok(workspace.segments.length > 0);
  });
});

test('coverage reads one append-only correction, void, and restore history', () => {
  withCoverageDatabase((filename) => {
    const before = getCoverageWorkspace(filename, '2026-08-25');
    const segmentId = before.segments[0]?.id;
    assert.ok(segmentId);
    const rootId = insertCoverageCompletionFixture(segmentId, '2026-07-01', filename);

    appendCoverageCorrection(rootId, '2026-07-20', filename);
    assert.equal(
      getCoverageWorkspace(filename, '2026-08-25').segments.find(({ id }) => id === segmentId)
        ?.lastCoveredOn,
      '2026-07-20',
    );

    appendCoverageCorrection(rootId, null, filename);
    assert.equal(
      getCoverageWorkspace(filename, '2026-08-25').segments.find(({ id }) => id === segmentId)
        ?.lastCoveredOn,
      null,
    );

    appendCoverageCorrection(rootId, '2026-07-21', filename);
    const restored = getCoverageWorkspace(filename, '2026-08-25').segments.find(
      ({ id }) => id === segmentId,
    );
    assert.equal(restored?.lastCoveredOn, '2026-07-21');
    assert.deepEqual(Object.keys(restored?.roots[0] ?? {}).sort(), [
      'corrections',
      'effectiveCoveredOn',
      'eventId',
      'originalCoveredOn',
      'packetId',
    ]);
    assert.deepEqual(
      restored?.roots[0]?.corrections.map(({ coveredOn, isVoid }) => ({ coveredOn, isVoid })),
      [
        { coveredOn: '2026-07-20', isVoid: false },
        { coveredOn: '2026-07-20', isVoid: true },
        { coveredOn: '2026-07-21', isVoid: false },
      ],
    );
  });
});
