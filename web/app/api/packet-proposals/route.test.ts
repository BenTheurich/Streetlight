import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import {
  getTerritoryWorkspace,
  recordCoverageCompletion,
  saveTerritoryDraft,
} from '../../../lib/database.ts';
import type { ImportedTerritoryInput } from '../../../lib/overture-import.ts';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import { proposePackets as POST } from './route.ts';

function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-packet-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  const original = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  return withTemeculaWorkspace(() => run(filename)).finally(() => {
    if (original === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = original;
    rmSync(directory, { recursive: true, force: true });
  });
}

function request(body: unknown): Request {
  return new Request('http://streetlight.local/api/packet-proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

function preparePacketGraph(filename: string): void {
  const workspace = getTerritoryWorkspace(filename);
  const imported: ImportedTerritoryInput = {
    release: '2026-06-17.0',
    center: workspace.center,
    radiusMiles: workspace.radiusMiles,
    completedAt: '2026-07-28T12:00:00.000Z',
    normalizerVersion: 10,
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
    segments: [
      {
        id: 'packet-a',
        sourceSegmentId: 'source-a',
        roadGroupId: 'group-a',
        roadClass: 'residential',
        streetName: 'Packet Road',
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [-117.1169, 33.5429],
            [-117.1168, 33.543],
          ],
        },
        estimatedHomes: 7,
        activationKind: 'automatic' as const,
        addresses: [
          {
            number: '10',
            street: 'Packet Road',
            locality: 'Temecula',
            postcode: '92591',
            position: [-117.1169, 33.5429] as [number, number],
          },
        ],
      },
      {
        id: 'packet-b',
        sourceSegmentId: 'source-b',
        roadGroupId: 'group-b',
        roadClass: 'residential',
        streetName: 'Packet Road',
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [-117.1168, 33.543],
            [-117.1167, 33.5431],
          ],
        },
        estimatedHomes: 8,
        activationKind: 'automatic' as const,
        addresses: [
          {
            number: '20',
            street: 'Packet Road',
            locality: 'Temecula',
            postcode: '92591',
            position: [-117.1167, 33.5431] as [number, number],
          },
        ],
      },
    ],
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

test('POST returns deterministic read-only packet proposals', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    const before = counts(filename);
    const body = { requests: [{ quantity: 1, targetHomes: 15 }] };

    const first = await POST(request(body));
    const firstText = await first.text();
    const second = await POST(request(body));
    const secondText = await second.text();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(secondText, firstText);
    assert.deepEqual(counts(filename), before);
    const result = JSON.parse(firstText);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].estimatedHomes, 15);
    assert.equal(result.proposals[0].segments.length, 2);
    assert.deepEqual(Object.keys(result.proposals[0].start).sort(), ['address', 'position']);
    assert.match(result.proposalFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(firstText.includes('addresses'), false);
  });
});

test('POST rejects malformed and inexact packet requests without mutation', async () => {
  await withDatabase(async (filename) => {
    preparePacketGraph(filename);
    const before = counts(filename);
    for (const body of [
      {},
      { requests: [] },
      { requests: [{ quantity: 0, targetHomes: 30 }] },
      { requests: [{ quantity: 1, targetHomes: 30 }], extra: true },
      { requests: [{ quantity: 1, targetHomes: 30, extra: true }] },
    ]) {
      const response = await POST(request(body));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Invalid packet request' });
      assert.deepEqual(counts(filename), before);
    }
  });
});

test('POST hides unexpected database failures', async () => {
  await withDatabase(async (filename) => {
    rmSync(filename);
    const response = await POST(request({ requests: [{ quantity: 1, targetHomes: 15 }] }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Could not generate packet proposals',
    });
  });
});
