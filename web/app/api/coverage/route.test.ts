import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { getTerritoryWorkspace, recordCoverageCompletion } from '../../../lib/database.ts';
import { POST } from './route.ts';

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  const original = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  return run(filename).finally(() => {
    if (original === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = original;
    rmSync(directory, { recursive: true, force: true });
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

function request(body: unknown): Request {
  return new Request('http://streetlight.local/api/coverage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST correction appends exactly one date correction and returns refreshed coverage', async () => {
  await withDatabase(async (filename) => {
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = recordCoverageCompletion(segment.id, '2026-07-01');
    const before = eventCount(filename);

    const response = await POST(request({ eventId, coveredOn: '2026-07-20' }));

    assert.equal(response.status, 200);
    assert.equal(eventCount(filename), before + 1);
    const workspace = (await response.json()) as {
      segments: Array<{ id: string; lastCoveredOn: string | null }>;
    };
    assert.equal(
      workspace.segments.find((current) => current.id === segment.id)?.lastCoveredOn,
      '2026-07-20',
    );
  });
});

test('POST correction void appends exactly one correction', async () => {
  await withDatabase(async (filename) => {
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = recordCoverageCompletion(segment.id, '2026-07-01');
    const before = eventCount(filename);

    const response = await POST(request({ eventId, coveredOn: null }));

    assert.equal(response.status, 200);
    assert.equal(eventCount(filename), before + 1);
    const workspace = (await response.json()) as {
      segments: Array<{ id: string; lastCoveredOn: string | null }>;
    };
    assert.equal(
      workspace.segments.find((current) => current.id === segment.id)?.lastCoveredOn,
      null,
    );
  });
});

test('POST correction rejects malformed, future, and unknown inputs without mutation', async () => {
  await withDatabase(async (filename) => {
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = recordCoverageCompletion(segment.id, '2026-07-01');
    const before = eventCount(filename);

    for (const body of [
      { eventId, coveredOn: '2026-07-32' },
      { eventId, coveredOn: '2999-01-01' },
      { eventId: 'missing', coveredOn: '2026-07-20' },
    ]) {
      const response = await POST(request(body));
      assert.ok(response.status === 400 || response.status === 404);
      assert.equal(eventCount(filename), before);
    }
  });
});

test('POST correction rejects any completion-shaped or inexact body without mutation', async () => {
  await withDatabase(async (filename) => {
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = recordCoverageCompletion(segment.id, '2026-07-01');
    const before = eventCount(filename);

    for (const body of [
      { eventId, coveredOn: '2026-07-20', segmentId: segment.id },
      { eventId, coveredOn: '2026-07-20', kind: 'completed' },
      { eventId },
      { eventId, coveredOn: '2026-07-20', extra: true },
    ]) {
      const response = await POST(request(body));
      assert.equal(response.status, 400);
      assert.equal(eventCount(filename), before);
    }
  });
});
