import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import type { AuthLoader } from '../../../lib/auth.ts';
import { handleMapData } from './route.ts';

const administrator: AuthLoader = async () => ({
  user: { id: 'administrator', email: 'admin@example.com' },
  organizationId: 'org_test_temecula',
});

test('authenticated administrators receive only their read-only open-map data', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-map-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  database
    .prepare('UPDATE churches SET onboarding_completed_at = NULL WHERE id = ?')
    .run('church-temecula-pilot');
  database.close();

  try {
    const response = await handleMapData(
      new Request('http://streetlight.local/api/map'),
      administrator,
      filename,
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as { churchId: string; buildings: unknown[] };
    assert.equal(result.churchId, 'church-temecula-pilot');
    assert.ok(Array.isArray(result.buildings));

    const override = await handleMapData(
      new Request('http://streetlight.local/api/map?churchId=other'),
      administrator,
      filename,
    );
    assert.equal(override.status, 400);

    const mutation = await handleMapData(
      new Request('http://streetlight.local/api/map', { method: 'POST' }),
      administrator,
      filename,
    );
    assert.equal(mutation.status, 405);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
