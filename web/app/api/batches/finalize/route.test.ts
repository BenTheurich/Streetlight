import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import {
  type FounderIdentityAdapter,
  listFounderChurchAccounts,
} from '../../../../lib/founder-church-accounts.ts';
import type { ImportedTerritoryInput } from '../../../../lib/overture-import.ts';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
} from '../../../../lib/territory-persistence.ts';
import { insertCoverageCompletionFixture } from '../../../../test/persistence-fixtures.ts';
import { withTemeculaWorkspace } from '../../../../test/workspace-fixtures.ts';
import { proposePackets as propose } from '../../packet-proposals/route.ts';
import { finalizePacketBatchRequest as finalize } from './route.ts';

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-finalize-route-'));
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

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function preparePacketGraph(filename: string): void {
  const workspace = getTerritoryWorkspace(filename);
  const imported: ImportedTerritoryInput = {
    release: '2026-08-19.0',
    center: workspace.center,
    radiusMiles: workspace.radiusMiles,
    completedAt: '2026-07-28T12:00:00.000Z',
    normalizerVersion: 12,
    buildingMode: 'overture_fema',
    mapBuildings: [],
    quality: {
      totalAddresses: 2,
      assignedAddresses: 2,
      spatiallyAssignedAddresses: 0,
      inferredRoads: 0,
      unmatchedAddresses: 0,
      unresolvedClusters: 0,
      totalResidentialBuildings: 0,
      fallbackBuildings: 0,
      unmatchedResidentialBuildings: 0,
      populatedUnnamedRoads: 0,
      buildingAddressDisagreements: 0,
      warnings: [],
    },
    segments: ['a', 'b'].map((suffix, index) => ({
      id: `packet-${suffix}`,
      sourceSegmentId: `source-${suffix}`,
      roadGroupId: 'packet-group',
      roadClass: 'residential',
      streetName: 'Packet Road',
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-117.1169 + index * 0.0001, 33.5429 + index * 0.0001],
          [-117.1168 + index * 0.0001, 33.543 + index * 0.0001],
        ] as [number, number][],
      },
      estimatedHomes: 8,
      activationKind: 'automatic' as const,
      addresses: [
        {
          number: String(10 + index * 10),
          street: 'Packet Road',
          locality: 'Temecula',
          postcode: '92591',
          position: [-117.1169 + index * 0.0001, 33.5429 + index * 0.0001] as [number, number],
        },
      ],
    })),
    apartmentSites: [],
  };
  replaceTerritoryFromImport(
    {
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles: workspace.radiusMiles,
      boundaryShape: workspace.boundaryShape,
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    },
    imported,
    { filename },
  );
  insertCoverageCompletionFixture('packet-a', '2025-01-01', filename);
  insertCoverageCompletionFixture('packet-b', '2025-01-01', filename);
}

function counts(filename: string): number[] {
  const database = openDatabase(filename);
  try {
    return ['batches', 'packets', 'packet_segments'].map(
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

test('finalization storage failures recover only after retrying the same proposals', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
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
    const mutate = authenticatedRoute(
      finalize,
      async () => ({
        user: { id: 'user_finalize', email: 'finalize@example.test' },
        organizationId: 'org_test_temecula',
      }),
      filename,
      false,
      'batch_finalization',
    );
    const bodies = [];
    for (const targetHomes of [16, 8]) {
      const requests = [{ quantity: 1, targetHomes }];
      const proposals = await (
        await propose(jsonRequest('http://streetlight.local/api/packet-proposals', { requests }))
      ).json();
      bodies.push({
        requests,
        proposalFingerprint: proposals.proposalFingerprint,
        proposalIndexes: proposals.proposalIndexes,
        customName: null,
      });
    }
    assert.notEqual(bodies[0].proposalFingerprint, bodies[1].proposalFingerprint);
    const database = openDatabase(filename);
    try {
      database.exec(`CREATE TRIGGER fail_finalization BEFORE INSERT ON batches
        BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END;`);
      const failed = await mutate(
        jsonRequest('http://streetlight.local/api/batches/finalize', bodies[0]),
      );
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { error: 'Could not finalize packet batch' });
      assert.deepEqual(counts(filename), [0, 0, 0]);
      database.exec('DROP TRIGGER fail_finalization');
      const other = await mutate(
        jsonRequest('http://streetlight.local/api/batches/finalize', bodies[1]),
      );
      assert.equal(other.status, 201);
      const otherBatch = await other.json();
      const rows = database.prepare('SELECT * FROM account_activity ORDER BY id').all();
      assert.deepEqual(
        rows.map(({ outcome, target_id }) => [outcome, target_id]),
        [
          ['failed', bodies[0].proposalFingerprint],
          ['succeeded', bodies[1].proposalFingerprint],
        ],
      );
      assert.ok(
        rows.every(
          (row) => row.church_id === 'church-temecula-pilot' && row.user_id === 'user_finalize',
        ),
      );
      assert.doesNotMatch(JSON.stringify(rows), /Synthetic storage failure|targetHomes|customName/);
      const readIssue = async () =>
        (await listFounderChurchAccounts(filename, provider)).churches
          .find((church) => church.id === 'church-temecula-pilot')
          ?.issues.find((issue) => issue.id === `activity-${rows[0].id}`);
      assert.equal((await readIssue())?.resolvedAt, null);
      // Release B's reservations so the original reviewed proposals can be retried.
      database.prepare("UPDATE packets SET status='cancelled' WHERE batch_id=?").run(otherBatch.id);
      assert.equal(
        (await mutate(jsonRequest('http://streetlight.local/api/batches/finalize', bodies[0])))
          .status,
        201,
      );
      assert.ok((await readIssue())?.resolvedAt);
    } finally {
      database.close();
    }
  });
});

test('POST finalizes the exact reviewed proposals once', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    const requests = [{ quantity: 1, targetHomes: 16 }];
    const proposalResponse = await propose(
      jsonRequest('http://streetlight.local/api/packet-proposals', { requests }),
    );
    const proposals = await proposalResponse.json();

    const body = {
      requests,
      proposalFingerprint: proposals.proposalFingerprint,
      proposalIndexes: proposals.proposalIndexes,
      customName: 'Summer Outreach',
    };
    const response = await finalize(
      jsonRequest('http://streetlight.local/api/batches/finalize', body),
    );

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.name, 'Summer Outreach');
    assert.equal(result.packetCount, 1);
    assert.deepEqual(counts(filename), [1, 1, 2]);

    const repeated = await finalize(
      jsonRequest('http://streetlight.local/api/batches/finalize', body),
    );
    assert.equal(repeated.status, 409);
    assert.deepEqual(await repeated.json(), {
      error: 'Packet proposals changed. Generate proposals again.',
    });
    assert.deepEqual(counts(filename), [1, 1, 2]);
  });
});

test('POST finalizes only the retained reviewed proposals', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    const requests = [{ quantity: 2, targetHomes: 8 }];
    const proposalResponse = await propose(
      jsonRequest('http://streetlight.local/api/packet-proposals', { requests }),
    );
    const proposals = await proposalResponse.json();
    assert.equal(proposals.proposals.length, 2);

    const response = await finalize(
      jsonRequest('http://streetlight.local/api/batches/finalize', {
        requests,
        proposalFingerprint: proposals.proposalFingerprint,
        proposalIndexes: [1],
        customName: null,
      }),
    );

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.packetCount, 1);
    assert.deepEqual(result.packets[0].segments, proposals.proposals[1].segments);
    assert.deepEqual(counts(filename), [1, 1, 1]);
  });
});

test('POST rejects malformed finalization without mutation', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    for (const body of [
      {},
      { requests: [{ quantity: 1, targetHomes: 16 }] },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'not-a-fingerprint',
        proposalIndexes: [0],
        customName: null,
      },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'a'.repeat(64),
        proposalIndexes: [0],
        customName: 'x'.repeat(81),
      },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'a'.repeat(64),
        proposalIndexes: [0],
        customName: null,
        extra: true,
      },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'a'.repeat(64),
        proposalIndexes: [0, 0],
        customName: null,
      },
    ]) {
      const response = await finalize(
        jsonRequest('http://streetlight.local/api/batches/finalize', body),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Invalid finalization request' });
      assert.deepEqual(counts(filename), [0, 0, 0]);
    }
  });
});
