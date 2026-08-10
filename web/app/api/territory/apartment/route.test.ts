import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import { getTerritoryWorkspace } from '../../../../lib/database.ts';
import { withTemeculaWorkspace } from '../../../../test/workspace-fixtures.ts';
import { updateApartmentSiteConfiguration, updateApartmentSiteMembership } from './route.ts';

async function withSeededDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-apartment-sites-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  const insertApartment = database.prepare(
    `INSERT INTO apartment_complexes (
      id, church_id, territory_id, import_complex_id, source_id, address, longitude, latitude,
      estimated_tracts, apartment_building, distinct_units, import_generation, members_json
    ) VALUES (?, 'church-temecula-pilot', 'territory-temecula-pilot', ?, ?, ?, ?, 33.5,
      1, 1, 0, 1, ?)`,
  );
  for (const [id, longitude] of [
    ['building-one', -117.14],
    ['building-two', -117.13],
  ] as const) {
    insertApartment.run(
      `${id}@1`,
      id,
      `source-${id}`,
      `${id === 'building-one' ? '10' : '20'} Main Street`,
      longitude,
      JSON.stringify([
        {
          id,
          sourceId: `source-${id}`,
          address: `${id === 'building-one' ? '10' : '20'} Main Street`,
          position: [longitude, 33.5],
          geometry: null,
          apartmentBuilding: true,
          distinctUnits: 0,
        },
      ]),
    );
  }
  database.close();
  const originalDatabase = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;

  try {
    await withTemeculaWorkspace(() => run(filename));
  } finally {
    if (originalDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
}

function request(method: 'PATCH' | 'POST', body: unknown): Request {
  return new Request('http://streetlight.local/api/territory/apartment', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('membership groups exact current evidence and rejects malformed requests', async () => {
  await withSeededDatabase(async (filename) => {
    const invalid = await updateApartmentSiteMembership(
      request('POST', { id: null, memberIds: ['building-one'], extra: true }),
    );
    assert.equal(invalid.status, 400);

    const response = await updateApartmentSiteMembership(
      request('POST', { id: null, memberIds: ['building-one', 'building-two'] }),
    );
    assert.equal(response.status, 200);
    const saved = (await response.json()) as ReturnType<typeof getTerritoryWorkspace>;
    assert.equal(saved.apartmentSites.length, 1);
    assert.equal(saved.apartmentSites[0].groupingConfirmed, true);
    assert.deepEqual(
      saved.apartmentSites[0].members.map(({ id }) => id),
      ['building-one', 'building-two'],
    );

    const duplicate = await updateApartmentSiteMembership(
      request('POST', { id: null, memberIds: ['building-one', 'building-one'] }),
    );
    assert.equal(duplicate.status, 400);
    assert.deepEqual(getTerritoryWorkspace(filename), saved);
  });
});

test('configuration requires all four facts before replay-safe inclusion', async () => {
  await withSeededDatabase(async (filename) => {
    const groupedResponse = await updateApartmentSiteMembership(
      request('POST', { id: null, memberIds: ['building-one', 'building-two'] }),
    );
    const grouped = (await groupedResponse.json()) as ReturnType<typeof getTerritoryWorkspace>;
    const id = grouped.apartmentSites[0].id;
    const base = {
      id,
      name: 'Sample Apartments',
      address: '10 Main Street',
      addressConfirmed: true,
      tractCount: 30,
      accessStatus: 'unknown',
      groupingConfirmed: true,
      includedInPackets: true,
    };

    const notReady = await updateApartmentSiteConfiguration(request('PATCH', base));
    assert.equal(notReady.status, 409);

    for (const value of [
      { ...base, accessStatus: 'open', tractCount: 0 },
      { ...base, accessStatus: 'private' },
      { ...base, accessStatus: 'open', extra: true },
    ]) {
      const invalid = await updateApartmentSiteConfiguration(request('PATCH', value));
      assert.equal(invalid.status, 400);
    }

    for (const includedInPackets of [true, true, false]) {
      const response = await updateApartmentSiteConfiguration(
        request('PATCH', { ...base, accessStatus: 'restricted', includedInPackets }),
      );
      assert.equal(response.status, 200);
      const saved = (await response.json()) as ReturnType<typeof getTerritoryWorkspace>;
      assert.equal(saved.apartmentSites[0].packetReady, true);
      assert.equal(saved.apartmentSites[0].includedInPackets, includedInPackets);
    }

    assert.equal(getTerritoryWorkspace(filename).apartmentSites[0].includedInPackets, false);
  });
});

test('unknown sites and evidence cannot escape the active church workspace', async () => {
  await withSeededDatabase(async () => {
    const missingConfiguration = await updateApartmentSiteConfiguration(
      request('PATCH', {
        id: 'other-church-site',
        name: null,
        address: '10 Main Street',
        addressConfirmed: true,
        tractCount: 10,
        accessStatus: 'open',
        groupingConfirmed: true,
        includedInPackets: false,
      }),
    );
    assert.equal(missingConfiguration.status, 404);

    const missingEvidence = await updateApartmentSiteMembership(
      request('POST', { id: null, memberIds: ['other-church-building'] }),
    );
    assert.equal(missingEvidence.status, 404);
  });
});
