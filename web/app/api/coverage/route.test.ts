import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { getCoverageWorkspace } from '../../../lib/coverage-persistence.ts';
import {
  type FounderIdentityAdapter,
  listFounderChurchAccounts,
} from '../../../lib/founder-church-accounts.ts';
import { getTerritoryWorkspace } from '../../../lib/territory-persistence.ts';
import { insertCoverageCompletionFixture } from '../../../test/persistence-fixtures.ts';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import {
  getCoverage as GET,
  updateCoverageRanges as PATCH,
  correctCoverage as POST,
} from './route.ts';

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-coverage-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  database.close();
  const original = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  return withTemeculaWorkspace(() => run(filename)).finally(() => {
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

function thresholdRequest(body: unknown): Request {
  return new Request('http://streetlight.local/api/coverage', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('coverage writes record trusted activity and failures while reads remain untracked', async () => {
  await withDatabase(async (filename) => {
    const loadSession = async () => ({
      user: { id: 'user_coverage', email: 'coverage@example.test' },
      organizationId: 'org_test_temecula',
    });
    const read = authenticatedRoute(GET, loadSession, filename);
    const ranges = authenticatedRoute(PATCH, loadSession, filename, false, 'coverage_settings');
    const correction = authenticatedRoute(
      POST,
      loadSession,
      filename,
      false,
      'coverage_correction',
    );
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
    const database = openDatabase(filename);
    try {
      assert.equal((await read(new Request('http://streetlight.local/api/coverage'))).status, 200);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM account_activity').get()?.count,
        0,
      );
      assert.equal(
        (
          await ranges(
            thresholdRequest({ yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 }),
          )
        ).status,
        200,
      );
      assert.equal((await correction(request({ eventId, coveredOn: '2026-07-20' }))).status, 200);
      assert.equal((await ranges(thresholdRequest({ yellowAfterDays: 0 }))).status, 400);
      assert.equal(
        (await correction(request({ eventId: 'missing', coveredOn: '2026-07-20' }))).status,
        404,
      );
      database.exec(`CREATE TRIGGER fail_heatmap_write BEFORE UPDATE OF coverage_yellow_after_days ON territories
        BEGIN SELECT RAISE(ABORT, 'Synthetic storage failure'); END;
        CREATE TRIGGER fail_coverage_write BEFORE INSERT ON coverage_events
        BEGIN SELECT RAISE(ABORT, 'Synthetic storage failure'); END;`);
      assert.equal(
        (
          await ranges(
            thresholdRequest({ yellowAfterDays: 31, orangeAfterDays: 61, redAfterDays: 91 }),
          )
        ).status,
        400,
      );
      assert.equal((await correction(request({ eventId, coveredOn: '2026-07-21' }))).status, 400);
      const rows = database.prepare('SELECT * FROM account_activity ORDER BY id').all();
      assert.deepEqual(
        rows.map(({ action, outcome }) => [action, outcome]),
        [
          ['coverage_settings', 'succeeded'],
          ['coverage_correction', 'succeeded'],
          ['coverage_settings', 'rejected'],
          ['coverage_correction', 'rejected'],
          ['coverage_settings', 'failed'],
          ['coverage_correction', 'failed'],
        ],
      );
      assert.ok(
        rows.every(
          (row) => row.church_id === 'church-temecula-pilot' && row.user_id === 'user_coverage',
        ),
      );
      assert.equal(rows[1].target_id, eventId);
      assert.equal(rows[5].target_id, eventId);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /Synthetic storage failure|coveredOn|yellowAfterDays/,
      );
    } finally {
      database.close();
    }
  });
});

test('coverage workspace read failures retain their target and recover only after its retry', async () => {
  await withDatabase(async (filename) => {
    const correction = authenticatedRoute(
      POST,
      async () => ({
        user: { id: 'user_coverage', email: 'coverage@example.test' },
        organizationId: 'org_test_temecula',
      }),
      filename,
      false,
      'coverage_correction',
    );
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
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventA = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
    const eventB = insertCoverageCompletionFixture(segment.id, '2026-07-02', filename);
    const database = openDatabase(filename);
    try {
      const geometry = database
        .prepare('SELECT geometry_geojson FROM street_segments WHERE import_segment_id = ?')
        .get(segment.id)?.geometry_geojson;
      assert.equal(typeof geometry, 'string');
      const before = eventCount(filename);
      database
        .prepare('UPDATE street_segments SET geometry_geojson = ? WHERE import_segment_id = ?')
        .run('Synthetic read failure', segment.id);
      const failed = await correction(request({ eventId: eventA, coveredOn: '2026-07-20' }));
      assert.equal(failed.status, 400);
      assert.deepEqual(await failed.json(), { error: 'Invalid correction request' });
      assert.equal(eventCount(filename), before);
      const row = database.prepare('SELECT * FROM account_activity ORDER BY id DESC LIMIT 1').get();
      assert.equal(row?.outcome, 'failed');
      assert.equal(row?.target_id, eventA);
      assert.equal(row?.church_id, 'church-temecula-pilot');
      assert.equal(row?.user_id, 'user_coverage');
      assert.doesNotMatch(JSON.stringify(row), /Synthetic read failure|coveredOn|SyntaxError/);
      database
        .prepare('UPDATE street_segments SET geometry_geojson = ? WHERE import_segment_id = ?')
        .run(geometry as string, segment.id);
      const readIssue = async () =>
        (await listFounderChurchAccounts(filename, provider)).churches
          .find((church) => church.id === 'church-temecula-pilot')
          ?.issues.find((issue) => issue.id === `activity-${row?.id}`);
      assert.equal((await readIssue())?.resolvedAt, null);
      assert.equal(
        (await correction(request({ eventId: eventB, coveredOn: '2026-07-20' }))).status,
        200,
      );
      assert.equal((await readIssue())?.resolvedAt, null);
      assert.equal(
        (await correction(request({ eventId: eventA, coveredOn: '2026-07-20' }))).status,
        200,
      );
      assert.ok((await readIssue())?.resolvedAt);
      assert.equal(
        (await correction(request({ eventId: eventA, coveredOn: 'invalid' }))).status,
        400,
      );
      assert.equal(
        database.prepare('SELECT outcome FROM account_activity ORDER BY id DESC LIMIT 1').get()
          ?.outcome,
        'rejected',
      );
    } finally {
      database.close();
    }
  });
});

test('GET returns the current coverage workspace without mutation', async () => {
  await withDatabase(async (filename) => {
    const before = eventCount(filename);

    const response = GET();

    assert.equal(response.status, 200);
    const workspace = (await response.json()) as {
      apartmentComplexes: unknown[];
      center: [number, number];
      segments: Array<{ id: string }>;
    };
    assert.deepEqual(workspace.apartmentComplexes, []);
    assert.equal(workspace.center.length, 2);
    assert.ok(workspace.segments.length > 0);
    assert.equal(eventCount(filename), before);
  });
});

test('POST correction appends exactly one date correction and returns refreshed coverage', async () => {
  await withDatabase(async (filename) => {
    const segment = getTerritoryWorkspace().segments.find((current) => current.eligible);
    assert.ok(segment);
    const eventId = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
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
    const eventId = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
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
    const eventId = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
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
    const eventId = insertCoverageCompletionFixture(segment.id, '2026-07-01', filename);
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

test('PATCH heatmap ranges persists all three thresholds and returns refreshed coverage', async () => {
  await withDatabase(async () => {
    const response = await PATCH(
      thresholdRequest({ yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90 }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
    assert.deepEqual(getCoverageWorkspace().thresholds, {
      yellowAfterDays: 30,
      orangeAfterDays: 60,
      redAfterDays: 90,
    });
  });
});

test('PATCH heatmap ranges rejects inexact and invalid values without mutation', async () => {
  await withDatabase(async () => {
    for (const body of [
      { yellowAfterDays: 0, orangeAfterDays: 60, redAfterDays: 90 },
      { yellowAfterDays: 60, orangeAfterDays: 60, redAfterDays: 90 },
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 3651 },
      { yellowAfterDays: 30.5, orangeAfterDays: 60, redAfterDays: 90 },
      { yellowAfterDays: 30, orangeAfterDays: 60 },
      { yellowAfterDays: 30, orangeAfterDays: 60, redAfterDays: 90, extra: true },
    ]) {
      const response = await PATCH(thresholdRequest(body));
      assert.equal(response.status, 400);
      assert.deepEqual(getCoverageWorkspace().thresholds, {
        yellowAfterDays: 90,
        orangeAfterDays: 180,
        redAfterDays: 365,
      });
    }
  });
});
