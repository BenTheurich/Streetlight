import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import { GET } from './route.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3z8AAAAASUVORK5CYII=',
  'base64',
);

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-pdf-route-'));
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
      VALUES ('batch-pdf', 'church-temecula-pilot', 'PDF batch', 'finalized',
        '2026-07-28T19:30:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
          sequence_number, start_longitude, start_latitude)
      VALUES ('packet-pdf', 'church-temecula-pilot', 'batch-pdf', 'TEM-PDF-001',
        '31087 Nicolas Rd, Temecula, CA 92591', 32, 'active', 0, -117.116885, 33.54293)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES ('church-temecula-pilot', 'packet-pdf', ?, 0)`,
    )
    .run(segment.id);
  database.close();
  const originalDatabase = process.env.STREETLIGHT_DATABASE_PATH;
  const originalKey = process.env.GOOGLE_MAPS_STATIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  process.env.GOOGLE_MAPS_STATIC_API_KEY = 'server-key';
  globalThis.fetch = async (input) => {
    if (String(input).includes('roads.googleapis.com')) {
      return Response.json({
        snappedPoints: [
          { location: { longitude: -117.1169, latitude: 33.5429 } },
          { location: { longitude: -117.1168, latitude: 33.543 } },
        ],
      });
    }
    return new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  };
  return run(filename).finally(() => {
    if (originalDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = originalDatabase;
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_STATIC_API_KEY;
    else process.env.GOOGLE_MAPS_STATIC_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  });
}

function counts(filename: string): number[] {
  const database = openDatabase(filename);
  try {
    return ['batches', 'packets', 'packet_segments', 'coverage_events'].map(
      (table) =>
        (
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
    );
  } finally {
    database.close();
  }
}

test('GET downloads the selected packet scope without database mutation', async () => {
  await withDatabase(async (filename) => {
    const before = counts(filename);
    for (const scope of ['newest', 'active']) {
      const response = await GET(
        new Request(`http://streetlight.local/api/packets/pdf?scope=${scope}`),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.match(response.headers.get('content-disposition') ?? '', /\.pdf"/);
      const document = await PDFDocument.load(await response.arrayBuffer());
      assert.equal(document.getPageCount(), 1);
      assert.deepEqual(counts(filename), before);
    }
  });
});

test('GET rejects invalid or empty download scopes', async () => {
  await withDatabase(async (filename) => {
    const invalid = await GET(
      new Request('http://streetlight.local/api/packets/pdf?scope=everything'),
    );
    assert.equal(invalid.status, 400);

    const database = openDatabase(filename);
    database.prepare("DELETE FROM batches WHERE id = 'batch-pdf'").run();
    database.close();
    const empty = await GET(new Request('http://streetlight.local/api/packets/pdf?scope=newest'));
    assert.equal(empty.status, 404);
  });
});
