import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
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

test('a valid settings write failure is recorded as failed, while invalid input is rejected', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-settings-failure-'));
  const filename = path.join(directory, 'test.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org-settings' });
  database.exec(
    `CREATE TRIGGER fail_settings BEFORE UPDATE OF packet_footer_message ON churches BEGIN SELECT RAISE(ABORT,'private storage error'); END;`,
  );
  const previous = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  const handler = authenticatedRoute(
    updateSettings,
    async () => ({
      user: { id: 'admin', email: 'admin@example.test' },
      organizationId: 'org-settings',
    }),
    filename,
    false,
    'printout_settings',
  );
  const request = (value: unknown) =>
    new Request('https://test.local/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(value),
    });
  try {
    assert.equal((await handler(request({ message: 'Outreach', reference: '' }))).status, 400);
    assert.equal((await handler(request({ extra: 'invalid' }))).status, 400);
    const rows = database.prepare('SELECT outcome FROM account_activity ORDER BY id').all();
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['failed', 'rejected'],
    );
    assert.doesNotMatch(
      JSON.stringify(database.prepare('SELECT * FROM account_activity').all()),
      /private storage error/,
    );
    database.exec('DROP TRIGGER fail_settings');
    assert.equal((await handler(request({ message: 'Outreach', reference: '' }))).status, 200);
  } finally {
    if (previous === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = previous;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
