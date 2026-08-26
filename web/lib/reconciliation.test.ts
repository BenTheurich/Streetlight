import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { insertCoverageCompletionFixture } from '../test/persistence-fixtures.ts';
import { withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { appendCoverageCorrection, getCoverageWorkspace } from './coverage-persistence.ts';
import { getPacketGenerationWorkspace } from './packet-persistence.ts';
import { APARTMENTS_ENABLED } from './product-capabilities.ts';
import {
  projectReconciliation,
  type ReconciliationBatch,
  type ReconciliationPacket,
  type ReconciliationWorkspace,
} from './reconciliation.ts';
import {
  applyReconciliation,
  type ReconciliationApplyResult,
  readReconciliation,
} from './reconciliation-persistence.ts';
import { runInWorkspace } from './workspace-scope.ts';

function accepted(result: ReconciliationApplyResult): ReconciliationWorkspace {
  if (result.kind !== 'accepted') assert.fail(`${result.kind}: ${result.message}`);
  return result.workspace;
}

test('one projection owns explicit sheet decisions and the stable retry submission', () => {
  const packet = (id: string): ReconciliationPacket => ({
    id,
    code: id,
    kind: 'street',
    status: 'active',
    estimatedTracts: 1,
    start: { address: `${id} Road`, position: [0, 0] },
    segments: [],
    apartment: null,
    completedOn: null,
    history: [],
  });
  const packets = [packet('still-here'), packet('taken'), packet('discarded')];
  const workspace: ReconciliationWorkspace = {
    asOf: '2026-08-25',
    defaultBatchId: 'batch',
    batches: [
      {
        id: 'batch',
        name: 'Batch',
        status: 'finalized',
        finalizedAt: '2026-08-25T12:00:00.000Z',
        packets,
        counts: { active: 3, completed: 0, cancelled: 0 },
      },
    ],
  };
  const outcomes = new Map([
    ['discarded', 'discarded'],
    ['taken', 'taken'],
    ['still-here', 'still-here'],
  ] as const);

  const projection = projectReconciliation(workspace, {
    batchId: 'batch',
    outcomes,
    selectedPacketId: 'taken',
    view: 'active',
  });

  assert.deepEqual(projection.review, {
    unreviewed: [],
    active: ['still-here'],
    complete: ['taken'],
    cancel: ['discarded'],
  });
  assert.deepEqual(projection.submission, {
    batchId: 'batch',
    decisions: [
      { packetId: 'still-here', outcome: 'still-here' },
      { packetId: 'taken', outcome: 'taken' },
      { packetId: 'discarded', outcome: 'discarded' },
    ],
  });
  assert.deepEqual(
    projection.map.packets.map(({ packet, disposition, selected }) => ({
      id: packet.id,
      disposition,
      selected,
    })),
    [{ id: 'taken', disposition: 'complete', selected: true }],
  );
});

async function withDatabase(run: (filename: string) => void | Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-reconciliation-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  try {
    await withTemeculaWorkspace(() => run(filename));
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
            import_generation, grouping_kind, grouping_confirmed, address_confirmed,
            confirmed_tracts, access_status, included_in_packets, members_json)
        VALUES ('apartment-physical', 'church-temecula-pilot', 'territory-temecula-pilot',
          'apartment-logical', 'apartment-source', '40 Apartment Way', -117.14, 33.57,
          24, 1, 24, 'ready', 0, 'admin_group', 1, 1, 24, 'open', 1,
          json_array(json_object(
            'id', 'apartment-logical',
            'sourceId', 'apartment-source',
            'address', '40 Apartment Way',
            'position', json_array(-117.14, 33.57),
            'geometry', NULL,
            'apartmentBuilding', json('true'),
            'distinctUnits', 24
          )))`,
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

    const packet = readReconciliation({ filename }).batches[0]?.packets.find(
      ({ id }) => id === 'legacy-packet',
    );
    assert.deepEqual(packet?.start.position, JSON.parse(segment.geometry_geojson).coordinates[0]);
  });
});

test('one projection owns active and history batches plus exact history targeting', () => {
  const packet = (id: string, status: ReconciliationPacket['status']): ReconciliationPacket => ({
    id,
    code: id,
    kind: 'street',
    status,
    estimatedTracts: 1,
    start: { address: id, position: [0, 0] },
    segments: [],
    apartment: null,
    completedOn: status === 'completed' ? '2026-07-29' : null,
    history: [],
  });
  const batch = (id: string, packets: ReconciliationPacket[]): ReconciliationBatch => ({
    id,
    name: id,
    status: 'finalized',
    finalizedAt: '2026-07-29T12:00:00.000Z',
    packets,
    counts: {
      active: packets.filter(({ status }) => status === 'active').length,
      completed: packets.filter(({ status }) => status === 'completed').length,
      cancelled: packets.filter(({ status }) => status === 'cancelled').length,
    },
  });
  const batches = [
    batch('active-batch', [packet('active-packet', 'active')]),
    batch('mixed-batch', [packet('mixed-active', 'active'), packet('mixed-history', 'completed')]),
    batch('history-batch', [
      packet('history-packet', 'completed'),
      packet('cancelled-packet', 'cancelled'),
    ]),
  ];
  const workspace: ReconciliationWorkspace = {
    asOf: '2026-07-29',
    defaultBatchId: 'active-batch',
    batches,
  };
  const projection = projectReconciliation(workspace, {
    batchId: 'active-batch',
    historyTarget: { packetId: 'history-packet' },
    outcomes: new Map(),
    selectedPacketId: null,
    view: 'active',
  });

  assert.deepEqual(
    projection.activeBatches.map(({ id }) => id),
    ['active-batch', 'mixed-batch'],
  );
  assert.deepEqual(
    projection.historyBatches.map(({ id }) => id),
    ['mixed-batch', 'history-batch'],
  );
  assert.deepEqual(projection.targetSelection, {
    batchId: 'history-batch',
    packetId: 'history-packet',
  });
  assert.equal(projection.view, 'history');
  assert.equal(projection.batch?.id, 'history-batch');
  assert.deepEqual(
    projection.map.packets.map(({ packet: candidate, selected }) => [candidate.id, selected]),
    [['history-packet', true]],
  );

  const unresolved = projectReconciliation(workspace, {
    batchId: 'active-batch',
    outcomes: new Map(),
    selectedPacketId: null,
    view: 'active',
  });
  assert.deepEqual(unresolved.review.unreviewed, ['active-packet']);
  assert.equal(unresolved.submission, null);
});

test('one reconciliation atomically completes missing packets, keeps present, cancels selected, and replays safely', async () => {
  await withDatabase(async (filename) => {
    const prepared = prepareBatch(filename);
    const now = new Date('2026-07-29T12:00:00.000Z');
    const before = readReconciliation({ filename, now });
    assert.equal(before.defaultBatchId, prepared.batchId);
    assert.equal(before.batches[0].packets.length, 4);

    const input = {
      batchId: prepared.batchId,
      decisions: [
        { packetId: prepared.streetPacketId, outcome: 'taken' },
        { packetId: prepared.keepPacketId, outcome: 'still-here' },
        { packetId: prepared.cancelPacketId, outcome: 'discarded' },
        { packetId: prepared.apartmentPacketId, outcome: 'taken' },
      ],
    };
    const after = accepted(applyReconciliation('reconcile', input, { filename, now }));
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
      () => appendCoverageCorrection(managedRoot.id, '2026-07-20', filename),
      /Reconcile packets/,
    );

    accepted(
      applyReconciliation('reconcile', input, {
        filename,
        now: new Date('2026-07-29T12:01:00.000Z'),
      }),
    );
    const apartmentCandidate = getPacketGenerationWorkspace(
      filename,
      '2026-07-29',
    ).apartmentComplexes.find(({ id }) => id === prepared.apartmentLogicalId);
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

    const stale = applyReconciliation(
      'reconcile',
      {
        ...input,
        decisions: input.decisions.map((decision) =>
          decision.packetId === prepared.streetPacketId
            ? { ...decision, outcome: 'still-here' }
            : decision,
        ),
      },
      { filename, now: new Date('2026-07-29T12:02:00.000Z') },
    );
    assert.deepEqual(stale, {
      kind: 'conflict',
      message: 'Reconciliation changed. Reload and review the batch again.',
    });
  });
});

test('a failure after the first completion event rolls back the whole reconciliation', async () => {
  await withDatabase((filename) => {
    const prepared = prepareBatch(filename);
    const database = openDatabase(filename);
    const beforeEvents = (
      database.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number }
    ).count;
    database.exec(`
      CREATE TRIGGER fail_second_packet_completion
      BEFORE INSERT ON coverage_events
      WHEN NEW.packet_id = 'packet-street'
        AND (SELECT COUNT(*) FROM coverage_events WHERE packet_id = NEW.packet_id) = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced reconciliation rollback');
      END;
    `);
    database.close();

    assert.throws(
      () =>
        applyReconciliation(
          'reconcile',
          {
            batchId: prepared.batchId,
            decisions: [
              { packetId: prepared.streetPacketId, outcome: 'taken' },
              { packetId: prepared.keepPacketId, outcome: 'still-here' },
              { packetId: prepared.cancelPacketId, outcome: 'still-here' },
              { packetId: prepared.apartmentPacketId, outcome: 'still-here' },
            ],
          },
          { filename, now: new Date('2026-07-29T12:00:00.000Z') },
        ),
      /forced reconciliation rollback/,
    );

    const unchanged = openDatabase(filename);
    try {
      assert.equal(
        (
          unchanged.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as {
            count: number;
          }
        ).count,
        beforeEvents,
      );
      assert.deepEqual(
        unchanged
          .prepare('SELECT status FROM packets WHERE batch_id = ? ORDER BY sequence_number')
          .all(prepared.batchId)
          .map((row) => ({ ...row })),
        [{ status: 'active' }, { status: 'active' }, { status: 'active' }, { status: 'active' }],
      );
      assert.deepEqual(
        {
          ...unchanged.prepare('SELECT status FROM batches WHERE id = ?').get(prepared.batchId),
        },
        { status: 'finalized' },
      );
    } finally {
      unchanged.close();
    }
  });
});

test('whole-packet correction and undo preserve earlier coverage and reject reservation conflicts', async () => {
  await withDatabase(async (filename) => {
    const prepared = prepareBatch(filename);
    insertCoverageCompletionFixture(prepared.streetLogicalIds[0], '2025-01-01', filename);
    accepted(
      applyReconciliation(
        'reconcile',
        {
          batchId: prepared.batchId,
          decisions: [
            { packetId: prepared.streetPacketId, outcome: 'taken' },
            { packetId: prepared.keepPacketId, outcome: 'still-here' },
            { packetId: prepared.cancelPacketId, outcome: 'discarded' },
            { packetId: prepared.apartmentPacketId, outcome: 'still-here' },
          ],
        },
        { filename, now: new Date('2026-07-29T12:00:00.000Z') },
      ),
    );

    accepted(
      applyReconciliation(
        'completion',
        { packetId: prepared.streetPacketId, coveredOn: '2026-07-20' },
        { filename, now: new Date('2026-07-29T13:00:00.000Z') },
      ),
    );
    const correctedCoverage = getCoverageWorkspace(filename, '2026-07-29');
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

    assert.deepEqual(
      applyReconciliation(
        'completion',
        { packetId: prepared.streetPacketId, coveredOn: null },
        { filename, now: new Date('2026-07-29T13:30:00.000Z') },
      ),
      {
        kind: 'conflict',
        message: 'Cannot undo while TEM-NEWER reserves this outreach',
      },
    );

    const release = openDatabase(filename);
    release.prepare("UPDATE packets SET status = 'cancelled' WHERE id = 'newer-packet'").run();
    release.close();
    accepted(
      applyReconciliation(
        'completion',
        { packetId: prepared.streetPacketId, coveredOn: null },
        { filename, now: new Date('2026-07-29T14:00:00.000Z') },
      ),
    );
    const undoneCoverage = getCoverageWorkspace(filename, '2026-07-29');
    assert.equal(
      undoneCoverage.segments.find(({ id }) => id === prepared.streetLogicalIds[0])?.lastCoveredOn,
      '2025-01-01',
    );
    assert.equal(
      undoneCoverage.segments.find(({ id }) => id === prepared.streetLogicalIds[1])?.lastCoveredOn,
      null,
    );
    assert.equal(
      readReconciliation({ filename, now: new Date('2026-07-29T14:00:00.000Z') })
        .batches.find(({ id }) => id === prepared.batchId)
        ?.packets.find(({ id }) => id === prepared.streetPacketId)?.status,
      'active',
    );
  });
});

test('foreign church batch, packet, event, and correction identifiers stay inaccessible', async () => {
  await withDatabase((filename) => {
    const prepared = prepareBatch(filename);
    const eventId = insertCoverageCompletionFixture(
      prepared.streetLogicalIds[0],
      '2026-07-01',
      filename,
    );
    const database = openDatabase(filename);
    const eventCount = (
      database.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as { count: number }
    ).count;
    database.close();

    runInWorkspace(
      {
        churchId: 'church-second-test',
        territoryId: 'territory-second-test',
        timeZone: 'America/New_York',
      },
      () => {
        assert.deepEqual(readReconciliation({ filename }).batches, []);
        assert.deepEqual(
          applyReconciliation(
            'reconcile',
            {
              batchId: prepared.batchId,
              decisions: [{ packetId: prepared.streetPacketId, outcome: 'taken' }],
            },
            { filename },
          ),
          { kind: 'not-found', message: 'Batch not found' },
        );
        assert.deepEqual(
          applyReconciliation(
            'completion',
            { packetId: prepared.streetPacketId, coveredOn: '2026-07-20' },
            { filename },
          ),
          { kind: 'not-found', message: 'Packet not found' },
        );
        assert.throws(
          () => appendCoverageCorrection(eventId, '2026-07-20', filename),
          /Coverage event not found/,
        );
      },
    );

    const unchanged = openDatabase(filename);
    assert.equal(
      (
        unchanged.prepare('SELECT COUNT(*) AS count FROM coverage_events').get() as {
          count: number;
        }
      ).count,
      eventCount,
    );
    unchanged.close();
  });
});

test('inconsistent packet completion groups fail as corrupt history', async () => {
  await withDatabase((filename) => {
    const prepared = prepareBatch(filename);
    const database = openDatabase(filename);
    const insert = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind)
      VALUES (?, 'church-temecula-pilot', ?, ?, 'corrupt-group', ?, 'completed')`,
    );
    insert.run('corrupt-one', prepared.streetPhysicalIds[0], prepared.streetPacketId, '2026-07-01');
    insert.run('corrupt-two', prepared.streetPhysicalIds[1], prepared.streetPacketId, '2026-07-02');
    database.close();

    assert.throws(
      () => readReconciliation({ filename, now: new Date('2026-07-29T12:00:00.000Z') }),
      /Invalid coverage history/,
    );
  });
});

test('preserved apartment packets still support completion, correction, and undo while disabled', async () => {
  await withDatabase((filename) => {
    assert.equal(APARTMENTS_ENABLED, false);
    const prepared = prepareBatch(filename);
    accepted(
      applyReconciliation(
        'reconcile',
        {
          batchId: prepared.batchId,
          decisions: [
            { packetId: prepared.streetPacketId, outcome: 'still-here' },
            { packetId: prepared.keepPacketId, outcome: 'still-here' },
            { packetId: prepared.cancelPacketId, outcome: 'still-here' },
            { packetId: prepared.apartmentPacketId, outcome: 'taken' },
          ],
        },
        { filename, now: new Date('2026-07-29T12:00:00.000Z') },
      ),
    );
    accepted(
      applyReconciliation(
        'completion',
        { packetId: prepared.apartmentPacketId, coveredOn: '2026-07-20' },
        { filename, now: new Date('2026-07-29T13:00:00.000Z') },
      ),
    );
    assert.equal(
      getCoverageWorkspace(filename, '2026-07-29').apartmentComplexes.find(
        ({ id }) => id === prepared.apartmentLogicalId,
      )?.lastCoveredOn,
      '2026-07-20',
    );

    accepted(
      applyReconciliation(
        'completion',
        { packetId: prepared.apartmentPacketId, coveredOn: null },
        { filename, now: new Date('2026-07-29T14:00:00.000Z') },
      ),
    );
    const restored = getPacketGenerationWorkspace(filename, '2026-07-29').apartmentComplexes.find(
      ({ id }) => id === prepared.apartmentLogicalId,
    );
    assert.equal(restored?.reserved, true);
    assert.equal(restored?.lastCoveredOn, null);
  });
});
