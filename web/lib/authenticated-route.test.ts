import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reconcilePackets } from '../app/api/reconciliation/route.ts';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { withAccountActivity } from './account-activity.ts';
import { authenticatedRoute } from './authenticated-route.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

const user = { id: 'user_test', email: 'admin@example.com' };

test('tracked routes attribute outcomes only after verified workspace access', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-tracked-routes-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
    const request = new Request('http://streetlight.local/api/test', {
      method: 'POST',
      body: JSON.stringify({ userId: 'forged', churchId: 'forged', secret: 'private' }),
    });
    const signedIn = async () => ({ user, organizationId: 'org_test_temecula' });
    for (const loadSession of [
      async () => ({ user: null }),
      async () => ({ user, organizationId: 'org_missing' }),
    ]) {
      const result = await authenticatedRoute(
        () => Response.json({ ok: true }),
        loadSession,
        filename,
        false,
        'territory_save',
      )(request);
      assert.ok([401, 403].includes(result.status));
    }
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM account_activity').get()?.count,
      0,
    );
    for (const status of [202, 201, 400, 409, 502]) {
      const result = await authenticatedRoute(
        () =>
          withAccountActivity(Response.json({ status }, { status }), { targetId: 'safe-target' }),
        signedIn,
        filename,
        false,
        'territory_save',
      )(request);
      assert.equal(result.status, status);
      assert.deepEqual(await result.json(), { status });
    }
    await assert.rejects(
      async () =>
        authenticatedRoute(
          () => {
            throw new Error('private provider error');
          },
          signedIn,
          filename,
          false,
          'territory_save',
        )(request),
      /private provider error/,
    );
    const rows = database.prepare('SELECT * FROM account_activity ORDER BY id').all();
    assert.deepEqual(
      rows.map(({ outcome }) => outcome),
      ['started', 'succeeded', 'rejected', 'rejected', 'failed', 'failed'],
    );
    assert.ok(
      rows.every((row) => row.church_id === 'church-temecula-pilot' && row.user_id === user.id),
    );
    assert.doesNotMatch(JSON.stringify(rows), /forged|private/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a recorder failure preserves the committed workflow and its response', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-tracking-failure-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  const warnings: unknown[] = [];
  t.mock.method(console, 'warn', (message: unknown) => warnings.push(message));
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
    database.exec('DROP TABLE account_activity');
    const response = await authenticatedRoute(
      () => {
        database
          .prepare('UPDATE churches SET name = ? WHERE id = ?')
          .run('Saved church name', 'church-temecula-pilot');
        return Response.json({ saved: true }, { status: 201 });
      },
      async () => ({ user, organizationId: 'org_test_temecula' }),
      filename,
      false,
      'printout_settings',
    )(new Request('http://streetlight.local/api/test'));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { saved: true });
    assert.equal(
      database.prepare('SELECT name FROM churches WHERE id = ?').get('church-temecula-pilot')?.name,
      'Saved church name',
    );
    assert.deepEqual(warnings, ['Could not record church account activity']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('authenticated routes reject missing access and run mapped sessions in church scope', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-auth-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
    database
      .prepare(
        `INSERT INTO churches (id, name, auth_organization_id, time_zone)
        VALUES ('church-setup', 'Setup Church', 'org_setup', 'America/Los_Angeles')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
        SELECT 'territory-setup', 'church-setup', 'Outreach territory',
          center_latitude, center_longitude, radius_meters, boundary_geojson, '1 Setup Street'
        FROM territories WHERE id = 'territory-temecula-pilot'`,
      )
      .run();
  } finally {
    database.close();
  }

  const request = new Request('http://streetlight.local/api/test');
  try {
    assert.equal(
      (
        await authenticatedRoute(
          () => Response.json({ ok: true }),
          async () => ({ user: null }),
          filename,
        )(request)
      ).status,
      401,
    );
    assert.equal(
      (
        await authenticatedRoute(
          () => Response.json({ ok: true }),
          async () => ({ user, organizationId: 'org_missing' }),
          filename,
        )(request)
      ).status,
      403,
    );

    const response = await authenticatedRoute(
      () => Response.json(requireWorkspaceScope()),
      async () => ({ user, organizationId: 'org_test_temecula' }),
      filename,
    )(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      churchId: 'church-temecula-pilot',
      territoryId: 'territory-temecula-pilot',
      timeZone: 'America/Los_Angeles',
    });

    const setupRequest = async () => ({ user, organizationId: 'org_setup' });
    assert.equal(
      (await authenticatedRoute(() => Response.json({ ok: true }), setupRequest, filename)(request))
        .status,
      403,
    );
    assert.equal(
      (
        await authenticatedRoute(
          () => Response.json({ ok: true }),
          setupRequest,
          filename,
          true,
        )(request)
      ).status,
      200,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a church cannot reconcile another church batch by stable ID', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-cross-church-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
    database
      .prepare(
        `INSERT INTO churches (id, name, auth_organization_id, time_zone)
        VALUES ('church-second-test', 'Second Test Church', 'org_test_second', 'America/New_York')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
        SELECT 'territory-second-test', 'church-second-test', 'Second Territory',
          center_latitude, center_longitude, radius_meters, boundary_geojson, '1 Second Street'
        FROM territories WHERE id = 'territory-temecula-pilot'`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('batch-second-test', 'church-second-test', 'Private batch', 'finalized',
          '2026-07-29T12:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
            sequence_number, start_longitude, start_latitude)
        VALUES ('packet-second-test', 'church-second-test', 'batch-second-test', 'SECOND-001',
          '1 Second Street', 10, 'active', 0, -73.75, 42.65)`,
      )
      .run();
  } finally {
    database.close();
  }

  const originalDatabasePath = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  try {
    const response = await authenticatedRoute(
      reconcilePackets,
      async () => ({ user, organizationId: 'org_test_temecula' }),
      filename,
    )(
      new Request('http://streetlight.local/api/reconciliation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          batchId: 'batch-second-test',
          decisions: [{ packetId: 'packet-second-test', outcome: 'still-here' }],
        }),
      }),
    );
    assert.equal(response.status, 404);

    const check = openDatabase(filename);
    try {
      assert.deepEqual(
        {
          ...check
            .prepare('SELECT status FROM batches WHERE id = ? AND church_id = ?')
            .get('batch-second-test', 'church-second-test'),
        },
        { status: 'finalized' },
      );
      assert.equal(
        (check.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number })
          .count,
        0,
      );
    } finally {
      check.close();
    }
  } finally {
    if (originalDatabasePath === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabasePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
