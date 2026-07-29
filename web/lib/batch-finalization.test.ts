import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import {
  finalizePacketBatch,
  getCoverageWorkspace,
  getPacketDownloadSelection,
  getPacketGenerationWorkspace,
  getTerritoryWorkspace,
  recordCoverageCompletion,
  saveTerritoryDraft,
} from './database.ts';
import type { ImportedTerritoryInput } from './overture-import.ts';
import { type PacketFinalizationInput, packetProposalFingerprint } from './packet-finalization.ts';
import { generatePacketProposals } from './packet-selection.ts';

function withDatabase(run: (filename: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-finalization-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  try {
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function preparePacketGraph(filename: string, includeApartment = false): void {
  const workspace = getTerritoryWorkspace(filename);
  const segments = ['A', 'B', 'C', 'D'].map((suffix, index) => ({
    id: `packet-${suffix.toLowerCase()}`,
    sourceSegmentId: `source-${suffix.toLowerCase()}`,
    roadGroupId: 'group-packet',
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
  }));
  const imported: ImportedTerritoryInput = {
    release: '2026-06-17.0',
    center: workspace.center,
    radiusMiles: workspace.radiusMiles,
    completedAt: '2026-07-28T12:00:00.000Z',
    normalizerVersion: 9,
    quality: {
      totalAddresses: segments.length,
      assignedAddresses: segments.length,
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
    segments,
    apartmentComplexes: includeApartment
      ? [
          {
            id: 'apartment-one',
            sourceId: 'building-one',
            address: '100 Apartment Way, Temecula CA 92591',
            position: [-117.11685, 33.54295],
            estimatedTracts: 24,
            evidence: { apartmentBuilding: true, distinctUnits: 24 },
          },
        ]
      : [],
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
  if (includeApartment) {
    saveTerritoryDraft(
      {
        originAddress: workspace.originAddress,
        center: workspace.center,
        radiusMiles: workspace.radiusMiles,
        boundaryShape: workspace.boundaryShape,
        exclusions: [],
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        apartmentStatuses: [{ id: 'apartment-one', reviewStatus: 'ready' }],
      },
      { filename },
    );
  }
  for (const segment of segments) recordCoverageCompletion(segment.id, '2025-01-01', filename);
}

test('ready apartment complexes finalize and reserve as separate atomic packets', () => {
  withDatabase((filename) => {
    preparePacketGraph(filename, true);
    const input = reviewedInput(filename);
    const reviewed = generatePacketProposals({
      ...getPacketGenerationWorkspace(filename, '2026-07-28'),
      requests: input.requests,
    });
    assert.equal(reviewed.proposals.length, 1);
    assert.equal(reviewed.proposals[0].kind, 'apartment');

    const finalized = finalizePacketBatch(input, {
      filename,
      now: new Date('2026-07-28T19:30:00.000Z'),
      asOf: '2026-07-28',
    });
    assert.equal(finalized.packetCount, 1);
    assert.equal(finalized.packets[0].apartmentId, 'apartment-one');

    const database = openDatabase(filename);
    try {
      assert.equal(
        (
          database.prepare('SELECT COUNT(*) AS count FROM packet_apartment_complexes').get() as {
            count: number;
          }
        ).count,
        1,
      );
    } finally {
      database.close();
    }
    assert.equal(
      getPacketGenerationWorkspace(filename, '2026-07-28').apartmentComplexes[0].reserved,
      true,
    );
    const apartmentDownload = getPacketDownloadSelection('newest', filename).packets[0];
    assert.equal(apartmentDownload.kind, 'apartment');
    assert.equal(apartmentDownload.apartmentId, 'apartment-one');
    assert.deepEqual(apartmentDownload.segments, []);
  });
});

function reviewedInput(filename: string, targetHomes = 16): PacketFinalizationInput {
  const requests = [{ quantity: 1, targetHomes }];
  const result = generatePacketProposals({
    ...getPacketGenerationWorkspace(filename, '2026-07-28'),
    requests,
  });
  return {
    requests,
    proposalFingerprint: packetProposalFingerprint(result.proposals),
    customName: '  Summer Outreach  ',
  };
}

test('finalization stores the reviewed packet and reserves every segment atomically', () => {
  withDatabase((filename) => {
    preparePacketGraph(filename);
    const finalized = finalizePacketBatch(reviewedInput(filename), {
      filename,
      now: new Date('2026-07-28T19:30:00.000Z'),
      asOf: '2026-07-28',
    });

    assert.equal(finalized.name, 'Summer Outreach');
    assert.equal(finalized.packetCount, 1);
    assert.equal(finalized.estimatedHomes, 16);
    assert.match(finalized.packets[0].code, /^TEM-20260728-[A-Z0-9]{6}-001$/);
    assert.deepEqual(getCoverageWorkspace(filename, '2026-07-28').latestBatch, {
      id: finalized.id,
      name: 'Summer Outreach',
      packetCount: 1,
      estimatedHomes: 16,
    });

    const database = openDatabase(filename);
    try {
      assert.deepEqual(
        {
          ...(database
            .prepare(
              `SELECT b.status AS batch_status, p.status AS packet_status, p.sequence_number,
              p.start_longitude, p.start_latitude, COUNT(ps.street_segment_id) AS segment_count
            FROM batches b
            JOIN packets p ON p.batch_id = b.id
            JOIN packet_segments ps ON ps.packet_id = p.id
            GROUP BY b.id, p.id`,
            )
            .get() as object),
        },
        {
          batch_status: 'finalized',
          packet_status: 'active',
          sequence_number: 0,
          start_longitude: finalized.packets[0].start.position[0],
          start_latitude: finalized.packets[0].start.position[1],
          segment_count: 2,
        },
      );
    } finally {
      database.close();
    }

    const next = generatePacketProposals({
      ...getPacketGenerationWorkspace(filename, '2026-07-28'),
      requests: [{ quantity: 1, targetHomes: 16 }],
    });
    assert.equal(
      next.proposals[0].segments.some(({ id }) =>
        finalized.packets[0].segments.some((segment) => segment.id === id),
      ),
      false,
    );
  });
});

test('repeated or stale finalization creates no second or partial batch', () => {
  withDatabase((filename) => {
    preparePacketGraph(filename);
    const input = reviewedInput(filename);
    finalizePacketBatch(input, {
      filename,
      now: new Date('2026-07-28T19:30:00.000Z'),
      asOf: '2026-07-28',
    });

    assert.throws(
      () =>
        finalizePacketBatch(input, {
          filename,
          now: new Date('2026-07-28T19:31:00.000Z'),
          asOf: '2026-07-28',
        }),
      /Packet proposals changed/,
    );

    const database = openDatabase(filename);
    try {
      assert.deepEqual(
        ['batches', 'packets', 'packet_segments'].map(
          (table) =>
            (
              database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
                count: number;
              }
            ).count,
        ),
        [1, 1, 2],
      );
    } finally {
      database.close();
    }
  });
});

test('download scopes return the newest complete batch or all active packets oldest first', () => {
  withDatabase((filename) => {
    preparePacketGraph(filename);
    const first = finalizePacketBatch(reviewedInput(filename), {
      filename,
      now: new Date('2026-07-28T19:30:00.000Z'),
      asOf: '2026-07-28',
    });
    const second = finalizePacketBatch(
      { ...reviewedInput(filename), customName: null },
      {
        filename,
        now: new Date('2026-07-28T20:30:00.000Z'),
        asOf: '2026-07-28',
      },
    );

    const newest = getPacketDownloadSelection('newest', filename);
    const active = getPacketDownloadSelection('active', filename);

    assert.equal(second.name, 'Outreach batch - July 28, 2026, 1:30 PM');
    assert.deepEqual(
      newest.packets.map(({ code }) => code),
      second.packets.map(({ code }) => code),
    );
    assert.deepEqual(
      active.packets.map(({ code }) => code),
      [...first.packets, ...second.packets].map(({ code }) => code),
    );
  });
});
