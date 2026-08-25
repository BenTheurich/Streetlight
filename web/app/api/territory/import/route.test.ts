import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import { territoryDraftFromWorkspace } from '../../../../lib/territory-client.ts';
import {
  createOrReuseTerritoryImportJob,
  getLatestTerritoryImportJob,
} from '../../../../lib/territory-import-job.ts';
import { getTerritoryWorkspace } from '../../../../lib/territory-persistence.ts';
import { withTemeculaWorkspace } from '../../../../test/workspace-fixtures.ts';
import { getTerritoryImport } from './route.ts';

test('polling reconnects to and starts the persisted territory import job', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-import-route-'));
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
      const draft = territoryDraftFromWorkspace(getTerritoryWorkspace(filename));
      draft.radiusMiles = 5;
      const queued = createOrReuseTerritoryImportJob(draft, filename);

      const response = getTerritoryImport();
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        job: { id: string; status: string };
        workspace: unknown;
      };
      assert.equal(payload.job.id, queued.id);
      assert.equal(payload.job.status, 'running');
      assert.equal(payload.workspace, null);

      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (getLatestTerritoryImportJob(filename)?.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(getLatestTerritoryImportJob(filename)?.status, 'failed');
    });
  } finally {
    if (originalDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabase;
    if (originalPython === undefined) delete process.env.STREETLIGHT_PYTHON;
    else process.env.STREETLIGHT_PYTHON = originalPython;
    rmSync(directory, { recursive: true, force: true });
  }
});
