import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import { handleSatelliteTile } from './satellite/[z]/[x]/[y]/route.ts';

const founder: AuthLoader = async () => ({
  user: { id: 'founder', email: 'bentheurich@gmail.com' },
  organizationId: 'org_test_temecula',
});

test('founder satellite proxy returns only tile bytes and supports no mutation', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-map-tile-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  database.close();
  const tileLoader = async () => ({
    bytes: Uint8Array.from([7, 8, 9]),
    contentType: 'image/jpeg',
    cacheControl: 'private, max-age=60',
  });

  try {
    const response = await handleSatelliteTile(
      new Request('http://streetlight.local/tile'),
      { z: '18', x: '45', y: '67' },
      founder,
      tileLoader,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=60');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7, 8, 9]);
    assert.equal(JSON.stringify([...response.headers]).includes('secret'), false);

    const mutation = await handleSatelliteTile(
      new Request('http://streetlight.local/tile', { method: 'POST' }),
      { z: '18', x: '45', y: '67' },
      founder,
      tileLoader,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(mutation.status, 405);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
