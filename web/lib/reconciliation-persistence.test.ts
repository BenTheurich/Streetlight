import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/migrate.mjs';
import { withSeededTemeculaDatabase } from '../test/persistence-fixtures.ts';
import { TEMECULA_TEST_WORKSPACE } from '../test/workspace-fixtures.ts';
import {
  applyReconciliation,
  ReconciliationApplyError,
  readReconciliation,
} from './reconciliation-persistence.ts';

function withBatches(run: (filename: string, segmentIds: string[]) => void) {
  withSeededTemeculaDatabase((filename) => {
    const database = openDatabase(filename);
    const churchId = TEMECULA_TEST_WORKSPACE.churchId;
    const segments = database
      .prepare(
        'SELECT id FROM street_segments WHERE church_id = ? AND is_current = 1 ORDER BY id LIMIT 2',
      )
      .all(churchId) as Array<{ id: string }>;
    try {
      for (const [index, name] of ['active', 'history'].entries()) {
        database
          .prepare(
            `INSERT INTO batches (id, church_id, name, status, finalized_at)
            VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            `${name}-batch`,
            churchId,
            name,
            index === 0 ? 'finalized' : 'reconciled',
            `2026-08-0${index + 1}T12:00:00.000Z`,
          );
        database
          .prepare(
            `INSERT INTO packets
              (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
            VALUES (?, ?, ?, ?, '100 Example Street', 10, ?)`,
          )
          .run(
            `${name}-packet`,
            churchId,
            `${name}-batch`,
            `${name}-code`,
            index === 0 ? 'active' : 'completed',
          );
        database
          .prepare(
            'INSERT INTO packet_segments (church_id, packet_id, street_segment_id, sequence_number) VALUES (?, ?, ?, 0)',
          )
          .run(churchId, `${name}-packet`, segments[index].id);
      }
      database
        .prepare(
          `INSERT INTO coverage_events
            (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind)
          VALUES ('history-event', ?, ?, 'history-packet', 'history-group', '2026-08-02', 'completed')`,
        )
        .run(churchId, segments[1].id);
    } finally {
      database.close();
    }
    run(
      filename,
      segments.map(({ id }) => id),
    );
  });
}

const now = new Date('2026-09-05T12:00:00.000Z');

test('reconciliation returns summaries and hydrates only the selected batch', () => {
  withBatches((filename) => {
    const current = readReconciliation({ filename, now });
    assert.equal(current.defaultBatchId, 'active-batch');
    assert.equal(current.batch?.id, 'active-batch');
    assert.deepEqual(
      current.batch?.packets.map(({ id }) => id),
      ['active-packet'],
    );
    assert.deepEqual(
      current.batches.map(({ id }) => id),
      ['history-batch', 'active-batch'],
    );
    assert.ok(current.batches.every((batch) => !Object.hasOwn(batch, 'packets')));
    const packet = current.batch?.packets[0];
    assert.deepEqual(packet?.start.position, packet?.segments[0].geometry.coordinates[0]);

    const history = readReconciliation({ filename, now, selection: { view: 'history' } });
    assert.equal(history.batch?.id, 'history-batch');
    assert.equal(history.batch?.packets[0].completedOn, '2026-08-02');
    assert.equal(history.batch?.packets[0].history.length, 1);
    assert.deepEqual(
      readReconciliation({ filename, now, selection: { packetId: 'history-packet' } }),
      history,
    );
  });
});

test('inactive archive geometry and events are not hydrated by an active-batch read', () => {
  withBatches((filename, segmentIds) => {
    const database = openDatabase(filename);
    try {
      database
        .prepare('UPDATE street_segments SET geometry_geojson = ? WHERE id = ?')
        .run('unreadable archived geometry', segmentIds[1]);
      database
        .prepare(
          `INSERT INTO coverage_events
          (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind)
        VALUES ('unreadable-history-date', ?, ?, 'history-packet', 'invalid-group', '2999-01-01', 'completed')`,
        )
        .run(TEMECULA_TEST_WORKSPACE.churchId, segmentIds[1]);
    } finally {
      database.close();
    }
    const current = readReconciliation({ filename, now, selection: { view: 'active' } });
    assert.equal(current.batch?.id, 'active-batch');
    assert.equal(current.batches.find(({ id }) => id === 'history-batch')?.counts.completed, 1);
    assert.throws(() =>
      readReconciliation({ filename, now, selection: { batchId: 'history-batch' } }),
    );
  });
});

test('missing and other-church batch or packet selections have the same not-found result', () => {
  withBatches((filename) => {
    const database = openDatabase(filename);
    try {
      database
        .prepare("INSERT INTO churches (id, name) VALUES ('other-church', 'Other Church')")
        .run();
      database
        .prepare(
          `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES ('other-batch', 'other-church', 'Other', 'finalized', '2026-08-01')`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO packets (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
        VALUES ('other-packet', 'other-church', 'other-batch', 'other', '100 Other Street', 1, 'active')`,
        )
        .run();
    } finally {
      database.close();
    }
    for (const selection of [
      { batchId: 'missing' },
      { batchId: 'other-batch' },
      { packetId: 'missing' },
      { packetId: 'other-packet' },
    ]) {
      assert.throws(
        () => readReconciliation({ filename, now, selection }),
        (error) => error instanceof ReconciliationApplyError && error.kind === 'not-found',
      );
    }
  });
});

test('mutations hydrate their affected batch and an empty active view returns no detail', () => {
  withBatches((filename) => {
    const result = applyReconciliation(
      'reconcile',
      {
        batchId: 'active-batch',
        decisions: [{ packetId: 'active-packet', outcome: 'taken' }],
      },
      { filename, now },
    );
    assert.equal(result.kind, 'accepted');
    if (result.kind !== 'accepted') return;
    assert.equal(result.workspace.defaultBatchId, 'history-batch');
    assert.equal(result.workspace.batch?.id, 'active-batch');
    assert.equal(result.workspace.batch?.packets[0].status, 'completed');
    assert.equal(readReconciliation({ filename, now, selection: { view: 'active' } }).batch, null);
  });
});
