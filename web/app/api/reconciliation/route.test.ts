import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import {
  type FounderIdentityAdapter,
  listFounderChurchAccounts,
} from '../../../lib/founder-church-accounts.ts';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import {
  getReconciliation as GET,
  correctPacket as PATCH,
  reconcilePackets as POST,
} from './route.ts';

async function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-reconciliation-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  const segment = database
    .prepare(
      `SELECT id FROM street_segments
      WHERE church_id = 'church-temecula-pilot' AND is_current = 1
      ORDER BY id LIMIT 1`,
    )
    .get() as { id: string };
  database
    .prepare(
      `INSERT INTO batches (id, church_id, name, status, finalized_at)
      VALUES ('route-batch', 'church-temecula-pilot', 'Route batch', 'finalized',
        '2026-07-28T18:00:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
          sequence_number, start_longitude, start_latitude, packet_kind)
      VALUES ('route-packet', 'church-temecula-pilot', 'route-batch', 'TEM-ROUTE',
        '10 Route Road', 10, 'active', 0, -117.11, 33.54, 'street')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES ('church-temecula-pilot', 'route-packet', ?, 0)`,
    )
    .run(segment.id);
  database.close();
  const original = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  try {
    await withTemeculaWorkspace(() => run(filename));
  } finally {
    if (original === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = original;
    rmSync(directory, { recursive: true, force: true });
  }
}

function request(method: 'POST' | 'PATCH', body: unknown): Request {
  return new Request('http://streetlight.local/api/reconciliation', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function eventCount(filename: string): number {
  const database = openDatabase(filename);
  try {
    return (
      database.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number }
    ).count;
  } finally {
    database.close();
  }
}

test('reconciliation storage failures recover only after success for the same batch or packet', async () => {
  await withDatabase(async (filename) => {
    const database = openDatabase(filename);
    const provider: FounderIdentityAdapter = {
      async listMemberships() {
        return [];
      },
      async listInvitations() {
        return [];
      },
      async getInvitation() {
        throw new Error('Unexpected invitation read');
      },
      async getUser() {
        throw new Error('Unexpected user read');
      },
    };
    const loadSession = async () => ({
      user: { id: 'user_reconcile', email: 'reconcile@example.test' },
      organizationId: 'org_test_temecula',
    });
    try {
      const segment = database
        .prepare(`SELECT id FROM street_segments
        WHERE church_id='church-temecula-pilot' AND is_current=1 ORDER BY id LIMIT 1 OFFSET 1`)
        .get() as { id: string };
      database.exec(`INSERT INTO batches (id,church_id,name,status,finalized_at)
        VALUES ('other-batch','church-temecula-pilot','Other batch','finalized','2026-07-28T18:00:00.000Z');
        INSERT INTO packets (id,church_id,batch_id,packet_code,start_address,estimated_homes,status,sequence_number,start_longitude,start_latitude,packet_kind)
        VALUES ('other-packet','church-temecula-pilot','other-batch','TEM-OTHER','20 Route Road',10,'active',0,-117.11,33.54,'street');`);
      database
        .prepare(`INSERT INTO packet_segments (church_id,packet_id,street_segment_id,sequence_number)
        VALUES ('church-temecula-pilot','other-packet',?,0)`)
        .run(segment.id);

      const cases = [
        {
          action: 'reconciliation' as const,
          handler: POST,
          method: 'POST' as const,
          targets: ['route-batch', 'other-batch'],
          bodies: [
            { batchId: 'route-batch', decisions: [{ packetId: 'route-packet', outcome: 'taken' }] },
            { batchId: 'other-batch', decisions: [{ packetId: 'other-packet', outcome: 'taken' }] },
          ],
        },
        {
          action: 'packet_correction' as const,
          handler: PATCH,
          method: 'PATCH' as const,
          targets: ['route-packet', 'other-packet'],
          bodies: [
            { packetId: 'route-packet', coveredOn: '2026-07-20' },
            { packetId: 'other-packet', coveredOn: '2026-07-20' },
          ],
        },
      ];
      for (const operation of cases) {
        const mutate = authenticatedRoute(
          operation.handler,
          loadSession,
          filename,
          false,
          operation.action,
        );
        database.exec(`CREATE TRIGGER fail_reconciliation_write BEFORE INSERT ON coverage_events
          WHEN NEW.packet_id='route-packet'
          BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END;`);
        const failed = await mutate(request(operation.method, operation.bodies[0]));
        assert.equal(failed.status, 500);
        assert.doesNotMatch(JSON.stringify(await failed.json()), /Synthetic storage failure/);
        database.exec('DROP TRIGGER fail_reconciliation_write');
        assert.equal((await mutate(request(operation.method, operation.bodies[1]))).status, 200);

        const rows = database
          .prepare('SELECT * FROM account_activity WHERE action=? ORDER BY id')
          .all(operation.action);
        assert.deepEqual(
          rows.map(({ outcome, target_id }) => [outcome, target_id]),
          [
            ['failed', operation.targets[0]],
            ['succeeded', operation.targets[1]],
          ],
        );
        assert.ok(
          rows.every(
            (row) => row.church_id === 'church-temecula-pilot' && row.user_id === 'user_reconcile',
          ),
        );
        assert.doesNotMatch(JSON.stringify(rows), /Synthetic storage failure|decisions|coveredOn/);
        const readIssue = async () => {
          const snapshot = await listFounderChurchAccounts(filename, provider);
          return snapshot.churches
            .find((church) => church.id === 'church-temecula-pilot')
            ?.issues.find((issue) => issue.id === `activity-${rows[0].id}`);
        };
        const unresolved = await readIssue();
        assert.ok(unresolved);
        assert.equal(unresolved.resolvedAt, null);
        assert.equal((await mutate(request(operation.method, operation.bodies[0]))).status, 200);
        assert.ok((await readIssue())?.resolvedAt);
      }
    } finally {
      database.close();
    }
  });
});

test('reconciliation route exposes read, confirm, replay, correction, and undo', async () => {
  await withDatabase(async (filename) => {
    const before = eventCount(filename);
    const get = GET();
    assert.equal(get.status, 200);
    assert.equal(eventCount(filename), before);

    const body = {
      batchId: 'route-batch',
      decisions: [{ packetId: 'route-packet', outcome: 'taken' }],
    };
    const confirmed = await POST(request('POST', body));
    assert.equal(confirmed.status, 200);
    assert.equal(eventCount(filename), before + 1);
    assert.equal((await confirmed.json()).batch.packets[0].status, 'completed');

    const replay = await POST(request('POST', body));
    assert.equal(replay.status, 200);
    assert.equal(eventCount(filename), before + 1);

    const corrected = await PATCH(
      request('PATCH', { packetId: 'route-packet', coveredOn: '2026-07-20' }),
    );
    assert.equal(corrected.status, 200);
    assert.equal((await corrected.json()).batch.packets[0].completedOn, '2026-07-20');

    const undone = await PATCH(request('PATCH', { packetId: 'route-packet', coveredOn: null }));
    assert.equal(undone.status, 200);
    assert.equal((await undone.json()).batch.packets[0].status, 'active');
  });
});

test('reconciliation reads validate and resolve batch or packet selection without writes', async () => {
  await withDatabase(async (filename) => {
    const before = eventCount(filename);
    for (const query of [
      'churchId=other',
      'view=all',
      'view=active&view=history',
      'batchId=',
      'batchId=route-batch&packetId=route-packet',
    ]) {
      assert.equal(
        GET(new Request(`http://streetlight.local/api/reconciliation?${query}`)).status,
        400,
      );
    }
    for (const query of ['batchId=missing', 'packetId=missing']) {
      assert.equal(
        GET(new Request(`http://streetlight.local/api/reconciliation?${query}`)).status,
        404,
      );
    }
    const result = await GET(
      new Request('http://streetlight.local/api/reconciliation?packetId=route-packet'),
    ).json();
    assert.equal(result.batch.id, 'route-batch');
    assert.equal(result.batch.packets[0].id, 'route-packet');
    assert.equal('packets' in result.batches[0], false);
    assert.equal(eventCount(filename), before);
  });
});

test('reconciliation route rejects malformed, stale, and missing requests without partial writes', async () => {
  await withDatabase(async (filename) => {
    const before = eventCount(filename);
    assert.equal((await POST(request('POST', {}))).status, 400);
    assert.equal(
      (
        await POST(
          request('POST', {
            batchId: 'route-batch',
            decisions: [{ packetId: 'route-packet', outcome: 'taken' }],
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await POST(
          request('POST', {
            batchId: 'route-batch',
            decisions: [{ packetId: 'route-packet', outcome: 'still-here' }],
          }),
        )
      ).status,
      409,
    );
    assert.equal(
      (await PATCH(request('PATCH', { packetId: 'missing-packet', coveredOn: '2026-07-20' })))
        .status,
      404,
    );
    assert.equal(eventCount(filename), before + 1);
  });
});
