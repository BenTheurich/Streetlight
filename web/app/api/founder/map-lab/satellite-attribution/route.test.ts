import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../../db/seed.mjs';
import type { AuthLoader } from '../../../../../lib/auth.ts';
import { handleSatelliteAttribution } from './route.ts';

const founder: AuthLoader = async () => ({
  user: { id: 'founder', email: 'bentheurich@gmail.com' },
  organizationId: 'org_test_temecula',
});

test('satellite attribution proxy returns viewport copyright only for the founder', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-map-attribution-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  database.close();
  const url =
    'http://streetlight.local/api/founder/map-lab/satellite-attribution' +
    '?zoom=18&north=33.55&south=33.53&east=-117.1&west=-117.13';

  try {
    const response = await handleSatelliteAttribution(
      new Request(url),
      founder,
      async () => 'Map data ©2026 Google, Maxar Technologies',
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      copyright: 'Map data ©2026 Google, Maxar Technologies',
    });

    const invalid = await handleSatelliteAttribution(
      new Request(`${url}&churchId=other`),
      founder,
      async () => 'never',
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(invalid.status, 400);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
