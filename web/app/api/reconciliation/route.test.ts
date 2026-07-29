import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { GET, PATCH, POST } from './route.ts';

async function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-reconciliation-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
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
    await run(filename);
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

test('reconciliation route exposes read, confirm, replay, correction, and undo', async () => {
  await withDatabase(async (filename) => {
    const before = eventCount(filename);
    const get = GET();
    assert.equal(get.status, 200);
    assert.equal(eventCount(filename), before);

    const body = {
      batchId: 'route-batch',
      activePacketIds: ['route-packet'],
      presentPacketIds: [],
      cancelPacketIds: [],
    };
    const confirmed = await POST(request('POST', body));
    assert.equal(confirmed.status, 200);
    assert.equal(eventCount(filename), before + 1);
    assert.equal(
      (await confirmed.json()).batches[0].packets[0].status,
      'completed',
    );

    const replay = await POST(request('POST', body));
    assert.equal(replay.status, 200);
    assert.equal(eventCount(filename), before + 1);

    const corrected = await PATCH(
      request('PATCH', { packetId: 'route-packet', coveredOn: '2026-07-20' }),
    );
    assert.equal(corrected.status, 200);
    assert.equal((await corrected.json()).batches[0].packets[0].completedOn, '2026-07-20');

    const undone = await PATCH(
      request('PATCH', { packetId: 'route-packet', coveredOn: null }),
    );
    assert.equal(undone.status, 200);
    assert.equal((await undone.json()).batches[0].packets[0].status, 'active');
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
            activePacketIds: ['route-packet'],
            presentPacketIds: [],
            cancelPacketIds: [],
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
            activePacketIds: ['route-packet'],
            presentPacketIds: ['route-packet'],
            cancelPacketIds: [],
          }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await PATCH(
          request('PATCH', { packetId: 'missing-packet', coveredOn: '2026-07-20' }),
        )
      ).status,
      404,
    );
    assert.equal(eventCount(filename), before + 1);
  });
});
