import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import { getSettings, updateSettings } from './route.ts';

test('church printout settings persist and can be removed', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-settings-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  const originalDatabase = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  try {
    await withTemeculaWorkspace(async () => {
      assert.deepEqual(await getSettings().json(), {
        message: 'Ye are the light of the world.',
        reference: 'Matthew 5:14',
      });
      const response = await updateSettings(
        new Request('http://streetlight.local/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ message: '', reference: '' }),
        }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { message: '', reference: '' });
      assert.deepEqual(await getSettings().json(), { message: '', reference: '' });
    });
  } finally {
    if (originalDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
