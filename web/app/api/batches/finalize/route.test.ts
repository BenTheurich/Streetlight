import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import { seedDatabase } from '../../../../db/seed.mjs';
import {
  getTerritoryWorkspace,
  recordCoverageCompletion,
  saveTerritoryDraft,
} from '../../../../lib/database.ts';
import type { ImportedTerritoryInput } from '../../../../lib/overture-import.ts';
import { POST as propose } from '../../packet-proposals/route.ts';
import { POST as finalize } from './route.ts';

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-finalize-route-'));
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
    release: '2026-06-17.0',
    center: workspace.center,
    radiusMiles: workspace.radiusMiles,
    completedAt: '2026-07-28T12:00:00.000Z',
    normalizerVersion: 9,
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
    apartmentComplexes: [],
  };
  saveTerritoryDraft(
    {
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles: workspace.radiusMiles,
      boundaryShape: workspace.boundaryShape,
      exclusions: [],
      activatedRoadGroupIds: [],
      excludedSegmentIds: [],
    },
    { filename, imported },
  );
  recordCoverageCompletion('packet-a', '2025-01-01', filename);
  recordCoverageCompletion('packet-b', '2025-01-01', filename);
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

test('POST rejects malformed finalization without mutation', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    for (const body of [
      {},
      { requests: [{ quantity: 1, targetHomes: 16 }] },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'not-a-fingerprint',
        customName: null,
      },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'a'.repeat(64),
        customName: 'x'.repeat(81),
      },
      {
        requests: [{ quantity: 1, targetHomes: 16 }],
        proposalFingerprint: 'a'.repeat(64),
        customName: null,
        extra: true,
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
