import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { territoryDraftFromWorkspace } from '../../../lib/territory-client.ts';
import { getTerritoryWorkspace } from '../../../lib/territory-persistence.ts';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import { getTerritoryImport } from './import/route.ts';
import { updateTerritory } from './route.ts';

test('an import-requiring save returns immediately and failure leaves saved territory unchanged', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-territory-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  const originalDatabase = process.env.STREETLIGHT_DATABASE_PATH;
  const originalPython = process.env.STREETLIGHT_PYTHON;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  process.env.STREETLIGHT_PYTHON = path.join(directory, 'missing-python.exe');

  try {
    await withTemeculaWorkspace(async () => {
      const before = getTerritoryWorkspace(filename);
      const draft = territoryDraftFromWorkspace(before);
      draft.radiusMiles = 5;
      draft.excludedSegmentIds = [before.segments[0].id];
      const response = await updateTerritory(
        new Request('http://streetlight.local/api/territory', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        }),
      );

      assert.equal(response.status, 202);
      const payload = (await response.json()) as { job: { id: string } };
      assert.ok(payload.job.id);
      assert.deepEqual(getTerritoryWorkspace(filename), before);
      let status = '';
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const poll = (await getTerritoryImport().json()) as { job: { status: string } | null };
        status = poll.job?.status ?? '';
        if (status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(status, 'failed');
      assert.deepEqual(getTerritoryWorkspace(filename), before);
    });
  } finally {
    if (originalDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabase;
    if (originalPython === undefined) delete process.env.STREETLIGHT_PYTHON;
    else process.env.STREETLIGHT_PYTHON = originalPython;
    rmSync(directory, { recursive: true, force: true });
  }
});
