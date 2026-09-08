import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { applicationHealth } from './route.ts';

test('health requires a migrated database and never creates a missing database', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-health-'));
  const filename = path.join(directory, 'health.db');
  try {
    assert.equal(applicationHealth(filename).status, 503);
    assert.equal(existsSync(filename), false);
    const database = openDatabase(filename);
    assert.equal(applicationHealth(filename).status, 503);
    migrateDatabase(database);
    database.close();
    const response = applicationHealth(filename);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
