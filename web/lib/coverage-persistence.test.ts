import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { saveCoverageThresholds } from './coverage-persistence.ts';

test('saving heatmap ranges returns the refreshed coverage workspace', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-persistence-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();

  try {
    withTemeculaWorkspace(() => {
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
