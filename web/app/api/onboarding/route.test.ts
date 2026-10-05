import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import type { AuthLoader } from '../../../lib/auth.ts';
import { handleOnboarding } from './route.ts';

const user = { id: 'user-new', email: 'new@example.com' };
const signedIn: AuthLoader = async () => ({ user, organizationId: 'org_new' });

function request(body: unknown): Request {
  return new Request('http://streetlight.local/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('onboarding route requires a mapped organization and returns the setup territory', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-onboarding-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database
    .prepare(
      `INSERT INTO churches (id, name, auth_organization_id)
      VALUES ('church-new', 'Provisional', 'org_new')`,
    )
    .run();
  database.close();
  try {
    const missing = await handleOnboarding(
      request({
        churchName: 'Grace',
        address: '1 Main',
        timeZone: 'America/Los_Angeles',
      }),
      async () => ({ user: null }),
      async () => ({ formattedAddress: 'unused', center: [0, 0] }),
      filename,
    );
    assert.equal(missing.status, 401);

    const invalid = await handleOnboarding(
      request({ churchName: 'Grace', address: '', timeZone: 'America/Los_Angeles' }),
      signedIn,
      async () => {
        throw new Error('Validation should not reach geocoding');
      },
      filename,
    );
    assert.equal(invalid.status, 400);
    const failed = await handleOnboarding(
      request({ churchName: 'Grace', address: '1 Main', timeZone: 'America/Los_Angeles' }),
      signedIn,
      async () => {
        throw new Error('Provider request failed');
      },
      filename,
    );
    assert.equal(failed.status, 400);

    const created = await handleOnboarding(
      request({
        churchName: 'Grace Church',
        address: '1 Main Street',
        timeZone: 'America/Los_Angeles',
      }),
      signedIn,
      async () => ({
        formattedAddress: '1 Main St, Temecula, CA 92590, USA',
        center: [-117.15, 33.5],
      }),
      filename,
    );
    assert.equal(created.status, 201);
    const payload = (await created.json()) as { territoryId: string };
    assert.match(payload.territoryId, /^territory-/);
    assert.deepEqual(payload, {
      territoryId: payload.territoryId,
      formattedAddress: '1 Main St, Temecula, CA 92590, USA',
      center: [-117.15, 33.5],
      radiusMiles: 1,
      boundaryShape: 'circle',
    });
    const check = openDatabase(filename);
    try {
      const rows = check.prepare('SELECT * FROM account_activity ORDER BY id').all();
      assert.deepEqual(
        rows.map(({ outcome }) => outcome),
        ['rejected', 'failed', 'succeeded'],
      );
      assert.ok(rows.every((row) => row.church_id === 'church-new' && row.user_id === user.id));
      assert.equal(rows[2].target_id, payload.territoryId);
      assert.doesNotMatch(JSON.stringify(rows), /Provider request failed|1 Main/);
    } finally {
      check.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
