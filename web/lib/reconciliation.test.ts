import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import {
  buildReconciliationPreview,
  parsePacketCompletionCorrection,
  parseReconciliationInput,
} from './reconciliation.ts';

async function withDatabase(run: (filename: string) => void | Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-reconciliation-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  try {
    await run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

type PreparedBatch = {
  batchId: string;
  streetPacketId: string;
  apartmentPacketId: string;
  keepPacketId: string;
  cancelPacketId: string;
  streetLogicalIds: string[];
  streetPhysicalIds: string[];
  apartmentLogicalId: string;
};

function prepareBatch(filename: string): PreparedBatch {
  const database = openDatabase(filename);
  try {
    const segments = database
      .prepare(
        `SELECT id, import_segment_id
        FROM street_segments
        WHERE church_id = 'church-temecula-pilot' AND is_current = 1
        ORDER BY id
        LIMIT 4`,
      )
      .all() as Array<{ id: string; import_segment_id: string }>;
    assert.equal(segments.length, 4);
    const batchId = 'reconciliation-batch';
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES (?, 'church-temecula-pilot', 'July outreach', 'finalized',
          '2026-07-28T18:00:00.000Z')`,
      )
      .run(batchId);
    const insertPacket = database.prepare(
      `INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
          sequence_number, start_longitude, start_latitude, packet_kind)
      VALUES (?, 'church-temecula-pilot', ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    );
    insertPacket.run(
      'packet-street',
      batchId,
      'TEM-STREET',
      '10 Street Road',
      20,
      0,
      -117.11,
      33.54,
      'street',
    );
    insertPacket.run(
      'packet-keep',
      batchId,
      'TEM-KEEP',
      '20 Keep Road',
      10,
      1,
      -117.12,
      33.55,
      'street',
    );
    insertPacket.run(
      'packet-cancel',
      batchId,
      'TEM-CANCEL',
      '30 Cancel Road',
      10,
      2,
      -117.13,
      33.56,
      'street',
    );
    insertPacket.run(
      'packet-apartment',
      batchId,
      'TEM-APARTMENT',
      '40 Apartment Way',
      24,
      3,
      -117.14,
      33.57,
      'apartment',
    );
    const insertSegment = database.prepare(
      `INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES ('church-temecula-pilot', ?, ?, ?)`,
    );
    insertSegment.run('packet-street', segments[0].id, 0);
    insertSegment.run('packet-street', segments[1].id, 1);
    insertSegment.run('packet-keep', segments[2].id, 0);
    insertSegment.run('packet-cancel', segments[3].id, 0);
    database
      .prepare(
        `INSERT INTO apartment_complexes
          (id, church_id, territory_id, import_complex_id, source_id, address, longitude,
            latitude, estimated_tracts, apartment_building, distinct_units, review_status,
            import_generation)
        VALUES ('apartment-physical', 'church-temecula-pilot', 'territory-temecula-pilot',
          'apartment-logical', 'apartment-source', '40 Apartment Way', -117.14, 33.57,
          24, 1, 24, 'ready', 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packet_apartment_complexes
          (church_id, packet_id, apartment_complex_id)
        VALUES ('church-temecula-pilot', 'packet-apartment', 'apartment-physical')`,
      )
      .run();
    return {
      batchId,
      streetPacketId: 'packet-street',
      apartmentPacketId: 'packet-apartment',
      keepPacketId: 'packet-keep',
      cancelPacketId: 'packet-cancel',
      streetLogicalIds: segments.slice(0, 2).map(({ import_segment_id }) => import_segment_id),
      streetPhysicalIds: segments.slice(0, 2).map(({ id }) => id),
      apartmentLogicalId: 'apartment-logical',
    };
  } finally {
    database.close();
  }
}

test('reconciliation migration supports packet-linked street or apartment coverage', async () => {
  await withDatabase((filename) => {
    const database = openDatabase(filename);
    try {
      const columns = database
        .prepare('PRAGMA table_info(coverage_events)')
        .all()
        .map((row) => (row as { name: string }).name);
      assert.ok(columns.includes('packet_id'));
      assert.ok(columns.includes('completion_group_id'));
      assert.ok(columns.includes('apartment_complex_id'));
    } finally {
      database.close();
    }
  });
});

test('database exposes the reconciliation transaction boundary', async () => {
  const databaseModule = await import('./database.ts');
  assert.equal(typeof databaseModule.getReconciliationWorkspace, 'function');
  assert.equal(typeof databaseModule.reconcilePacketBatch, 'function');
  assert.equal(typeof databaseModule.correctPacketCompletion, 'function');
});

test('legacy packets without saved coordinates use their stored outreach geometry', async () => {
  await withDatabase(async (filename) => {
    const database = openDatabase(filename);
    const segment = database
      .prepare(
        `SELECT id, geometry_geojson
        FROM street_segments
        WHERE church_id = 'church-temecula-pilot'
        ORDER BY id
        LIMIT 1`,
      )
      .get() as { id: string; geometry_geojson: string };
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('legacy-batch', 'church-temecula-pilot', 'Legacy', 'finalized',
          '2026-07-28T18:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
            sequence_number, packet_kind)
        VALUES ('legacy-packet', 'church-temecula-pilot', 'legacy-batch', 'TEM-LEGACY',
          'Legacy starting address', 10, 'active', 0, 'street')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
        VALUES ('church-temecula-pilot', 'legacy-packet', ?, 0)`,
      )
      .run(segment.id);
    database.close();

    const databaseModule = await import('./database.ts');
    const packet = databaseModule
      .getReconciliationWorkspace(filename)
      .batches[0]?.packets.find(({ id }) => id === 'legacy-packet');
    assert.deepEqual(packet?.start.position, JSON.parse(segment.geometry_geojson).coordinates[0]);
  });
});

test('reconciliation request parsers accept only exact whole-packet choices', async () => {
  const valid = {
    batchId: 'batch',
    activePacketIds: ['one', 'two'],
    presentPacketIds: ['two'],
    cancelPacketIds: ['two'],
  };
  assert.deepEqual(parseReconciliationInput(valid), valid);
  assert.deepEqual(
    parsePacketCompletionCorrection(
      {
        packetId: 'one',
        coveredOn: '2026-07-20',
      },
      '2026-07-29',
    ),
    { packetId: 'one', coveredOn: '2026-07-20' },
  );
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, activePacketIds: ['one', 'one'] },
    { ...valid, presentPacketIds: ['missing'] },
    { ...valid, cancelPacketIds: ['one'] },
  ]) {
    assert.throws(() => parseReconciliationInput(invalid), /Invalid reconciliation request/);
  }
});

test('reconciliation preview derives complete, active, and cancel groups from physical sheets', () => {
  assert.deepEqual(
    buildReconciliationPreview(['one', 'two', 'three'], ['two', 'three'], ['three']),
    {
      complete: ['one'],
      active: ['two'],
      cancel: ['three'],
    },
  );
  assert.throws(
    () => buildReconciliationPreview(['one', 'two'], ['two'], ['one']),
    /Invalid reconciliation choices/,
  );
});

test('one reconciliation atomically completes missing packets, keeps present, cancels selected, and replays safely', async () => {
  await withDatabase(async (filename) => {
    const prepared = prepareBatch(filename);
    const databaseModule = await import('./database.ts');
    assert.equal(typeof databaseModule.getReconciliationWorkspace, 'function');
    assert.equal(typeof databaseModule.reconcilePacketBatch, 'function');
    if (
      typeof databaseModule.getReconciliationWorkspace !== 'function' ||
      typeof databaseModule.reconcilePacketBatch !== 'function'
    ) {
      return;
    }
    const before = databaseModule.getReconciliationWorkspace(filename);
    assert.equal(before.defaultBatchId, prepared.batchId);
    assert.equal(before.batches[0].packets.length, 4);

    const input = {
      batchId: prepared.batchId,
      activePacketIds: [
        prepared.streetPacketId,
        prepared.keepPacketId,
        prepared.cancelPacketId,
        prepared.apartmentPacketId,
      ],
      presentPacketIds: [prepared.keepPacketId, prepared.cancelPacketId],
      cancelPacketIds: [prepared.cancelPacketId],
    };
    const after = databaseModule.reconcilePacketBatch(input, {
      filename,
      now: new Date('2026-07-29T12:00:00.000Z'),
    });
    const batch = after.batches.find(({ id }) => id === prepared.batchId);
    assert.ok(batch);
    assert.deepEqual(
      batch.packets.map(({ id, status }) => [id, status]),
      [
        [prepared.streetPacketId, 'completed'],
        [prepared.keepPacketId, 'active'],
        [prepared.cancelPacketId, 'cancelled'],
        [prepared.apartmentPacketId, 'completed'],
      ],
    );
    assert.equal(batch.status, 'finalized');
    assert.equal(
      batch.packets.find(({ id }) => id === prepared.streetPacketId)?.completedOn,
      '2026-07-29',
    );
    assert.equal(
      batch.packets.find(({ id }) => id === prepared.apartmentPacketId)?.completedOn,
      '2026-07-29',
    );

    const database = openDatabase(filename);
    const eventCount = (
      database.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number }
    ).count;
    assert.equal(eventCount, 3);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(DISTINCT completion_group_id) AS count
            FROM coverage_events WHERE packet_id IS NOT NULL`,
          )
          .get() as { count: number }
      ).count,
      2,
    );
    const managedRoot = database
      .prepare(
        `SELECT id FROM coverage_events
        WHERE packet_id = ? AND kind = 'completed'
        ORDER BY rowid LIMIT 1`,
      )
      .get(prepared.streetPacketId) as { id: string };
    database.close();
    assert.throws(
      () => databaseModule.appendCoverageCorrection(managedRoot.id, '2026-07-20', filename),
      /Reconcile packets/,
    );

    databaseModule.reconcilePacketBatch(input, {
      filename,
      now: new Date('2026-07-29T12:01:00.000Z'),
    });
    const apartmentCandidate = databaseModule
      .getPacketGenerationWorkspace(filename, '2026-07-29')
      .apartmentComplexes.find(({ id }) => id === prepared.apartmentLogicalId);
    assert.equal(apartmentCandidate?.reserved, false);
    assert.equal(apartmentCandidate?.lastCoveredOn, '2026-07-29');
    assert.equal(apartmentCandidate?.coverageClass, 'green');
    const replayed = openDatabase(filename);
    assert.equal(
      (replayed.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number })
        .count,
      eventCount,
    );
    replayed.close();

    assert.throws(
      () =>
        databaseModule.reconcilePacketBatch(
          {
            ...input,
            presentPacketIds: [
              prepared.streetPacketId,
              prepared.keepPacketId,
              prepared.cancelPacketId,
            ],
          },
          { filename, now: new Date('2026-07-29T12:02:00.000Z') },
        ),
      /Reconciliation changed/,
    );
  });
});

test('whole-packet correction and undo preserve earlier coverage and reject reservation conflicts', async () => {
  await withDatabase(async (filename) => {
    const prepared = prepareBatch(filename);
    const databaseModule = await import('./database.ts');
    assert.equal(typeof databaseModule.reconcilePacketBatch, 'function');
    assert.equal(typeof databaseModule.correctPacketCompletion, 'function');
    if (
      typeof databaseModule.reconcilePacketBatch !== 'function' ||
      typeof databaseModule.correctPacketCompletion !== 'function'
    ) {
      return;
    }
    databaseModule.recordCoverageCompletion(prepared.streetLogicalIds[0], '2025-01-01', filename);
    databaseModule.reconcilePacketBatch(
      {
        batchId: prepared.batchId,
        activePacketIds: [
          prepared.streetPacketId,
          prepared.keepPacketId,
          prepared.cancelPacketId,
          prepared.apartmentPacketId,
        ],
        presentPacketIds: [
          prepared.keepPacketId,
          prepared.cancelPacketId,
          prepared.apartmentPacketId,
        ],
        cancelPacketIds: [prepared.cancelPacketId],
      },
      { filename, now: new Date('2026-07-29T12:00:00.000Z') },
    );

    databaseModule.correctPacketCompletion(
      { packetId: prepared.streetPacketId, coveredOn: '2026-07-20' },
      { filename, now: new Date('2026-07-29T13:00:00.000Z') },
    );
    const correctedCoverage = databaseModule.getCoverageWorkspace(filename, '2026-07-29');
    for (const id of prepared.streetLogicalIds) {
      assert.equal(
        correctedCoverage.segments.find((segment) => segment.id === id)?.lastCoveredOn,
        '2026-07-20',
      );
    }

    const conflictDatabase = openDatabase(filename);
    conflictDatabase
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('newer-batch', 'church-temecula-pilot', 'Newer', 'finalized',
          '2026-07-29T12:30:00.000Z')`,
      )
      .run();
    conflictDatabase
      .prepare(
        `INSERT INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
            sequence_number, start_longitude, start_latitude, packet_kind)
        VALUES ('newer-packet', 'church-temecula-pilot', 'newer-batch', 'TEM-NEWER',
          '50 Newer Road', 10, 'active', 0, -117.15, 33.58, 'street')`,
      )
      .run();
    conflictDatabase
      .prepare(
        `INSERT INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
        VALUES ('church-temecula-pilot', 'newer-packet', ?, 0)`,
      )
      .run(prepared.streetPhysicalIds[0]);
    conflictDatabase.close();

    assert.throws(
      () =>
        databaseModule.correctPacketCompletion(
          { packetId: prepared.streetPacketId, coveredOn: null },
          { filename, now: new Date('2026-07-29T13:30:00.000Z') },
        ),
      /TEM-NEWER/,
    );

    const release = openDatabase(filename);
    release.prepare("UPDATE packets SET status = 'cancelled' WHERE id = 'newer-packet'").run();
    release.close();
    databaseModule.correctPacketCompletion(
      { packetId: prepared.streetPacketId, coveredOn: null },
      { filename, now: new Date('2026-07-29T14:00:00.000Z') },
    );
    const undoneCoverage = databaseModule.getCoverageWorkspace(filename, '2026-07-29');
    assert.equal(
      undoneCoverage.segments.find(({ id }) => id === prepared.streetLogicalIds[0])?.lastCoveredOn,
      '2025-01-01',
    );
    assert.equal(
      undoneCoverage.segments.find(({ id }) => id === prepared.streetLogicalIds[1])?.lastCoveredOn,
      null,
    );
    assert.equal(
      databaseModule
        .getReconciliationWorkspace(filename)
        .batches.find(({ id }) => id === prepared.batchId)
        ?.packets.find(({ id }) => id === prepared.streetPacketId)?.status,
      'active',
    );
  });
});
