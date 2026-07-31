import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import { handleMapLabData } from './route.ts';

const founder: AuthLoader = async () => ({
  user: { id: 'founder', email: 'bentheurich@gmail.com' },
  organizationId: 'org_test_temecula',
});
const ordinary: AuthLoader = async () => ({
  user: { id: 'ordinary', email: 'admin@example.com' },
  organizationId: 'org_test_temecula',
});

function request(method = 'GET', query = ''): Request {
  return new Request(`http://streetlight.local/api/founder/map-lab${query}`, { method });
}

test('map lab data is founder-only, church-scoped, and read-only', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-map-lab-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  database
    .prepare(
      `INSERT INTO map_buildings
        (church_id, territory_id, import_generation, source, source_feature_id,
          geometry_geojson, overture_release, retrieved_at)
      VALUES (?, ?, 0, 'overture', 'building-current', ?, '2026-06-17.0', ?)`,
    )
    .run(
      'church-temecula-pilot',
      'territory-temecula-pilot',
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [-117.117, 33.541],
            [-117.1169, 33.541],
            [-117.1169, 33.5411],
            [-117.117, 33.541],
          ],
        ],
      }),
      '2026-07-30T00:00:00Z',
    );
  const segmentId = database
    .prepare(
      `SELECT id
      FROM street_segments
      WHERE church_id = ? AND territory_id = ? AND is_current = 1
      ORDER BY id
      LIMIT 1`,
    )
    .get('church-temecula-pilot', 'territory-temecula-pilot') as { id: string };
  const insertAddress = database.prepare(
    `INSERT INTO segment_addresses
      (street_segment_id, house_number, street, longitude, latitude)
    VALUES (?, ?, 'Amberley Circle', ?, ?)`,
  );
  insertAddress.run(segmentId.id, '31308', -117.1114, 33.5395);
  insertAddress.run(segmentId.id, null, -117.1115, 33.5396);
  database.close();

  try {
    const hidden = await handleMapLabData(request(), ordinary, filename, 'bentheurich@gmail.com');
    assert.equal(hidden.status, 404);

    const signedOut = await handleMapLabData(
      request(),
      async () => ({ user: null }),
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(signedOut.status, 401);

    const response = await handleMapLabData(request(), founder, filename, 'bentheurich@gmail.com');
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      churchId: string;
      territoryId: string;
      bounds: [number, number, number, number];
      segments: Array<{ roadClass: string; coverageClass: string }>;
      buildings: Array<{ sourceId: string }>;
      houseNumbers: Array<{ number: string; street: string; position: [number, number] }>;
    };
    assert.equal(result.churchId, 'church-temecula-pilot');
    assert.equal(result.territoryId, 'territory-temecula-pilot');
    assert.equal(result.bounds.length, 4);
    assert.ok(result.segments.every(({ roadClass, coverageClass }) => roadClass && coverageClass));
    assert.deepEqual(
      result.buildings.map(({ sourceId }) => sourceId),
      ['building-current'],
    );
    assert.equal('femaAuditCandidates' in result, false);
    assert.deepEqual(result.houseNumbers, [
      { number: '31308', street: 'Amberley Circle', position: [-117.1114, 33.5395] },
    ]);

    const override = await handleMapLabData(
      request('GET', '?churchId=other'),
      founder,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(override.status, 400);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const mutation = await handleMapLabData(
        request(method),
        founder,
        filename,
        'bentheurich@gmail.com',
      );
      assert.equal(mutation.status, 405);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
