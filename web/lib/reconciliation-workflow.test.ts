import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ReconciliationPacket,
  ReconciliationSubmission,
  ReconciliationWorkspace,
} from './reconciliation.ts';
import {
  createReconciliationWorkflow,
  type ReconciliationTransport,
} from './reconciliation-workflow.ts';

function packet(
  id: string,
  status: ReconciliationPacket['status'] = 'active',
): ReconciliationPacket {
  return {
    id,
    code: id.toUpperCase(),
    kind: 'street',
    status,
    estimatedTracts: 12,
    start: { address: `${id} Road`, position: [-117.1, 33.5] },
    segments: [],
    apartment: null,
    completedOn: status === 'completed' ? '2026-08-20' : null,
    history: [],
  };
}

function workspace(
  packets: ReconciliationPacket[] = [packet('packet-a'), packet('packet-b')],
): ReconciliationWorkspace {
  return {
    asOf: '2026-08-26',
    defaultBatchId: 'batch-a',
    batches: [
      {
        id: 'batch-a',
        name: 'August outreach',
        status: 'finalized',
        finalizedAt: '2026-08-20T12:00:00.000Z',
        packets,
        counts: {
          active: packets.filter(({ status }) => status === 'active').length,
          completed: packets.filter(({ status }) => status === 'completed').length,
          cancelled: packets.filter(({ status }) => status === 'cancelled').length,
        },
      },
    ],
  };
}

function transportWith(overrides: Partial<ReconciliationTransport> = {}): ReconciliationTransport {
  return {
    load: () => Promise.resolve(Response.json(workspace())),
    reconcile: () => Promise.reject(new Error('unexpected reconcile')),
    correct: () => Promise.reject(new Error('unexpected correction')),
    ...overrides,
  };
}

test('a malformed successful load is unavailable instead of becoming accepted state', async () => {
  const transport: ReconciliationTransport = {
    load: () => Promise.resolve(Response.json({ batches: [] })),
    reconcile: () => Promise.reject(new Error('unexpected reconcile')),
    correct: () => Promise.reject(new Error('unexpected correction')),
  };
  const workflow = createReconciliationWorkflow({
    onAccepted: () => Promise.resolve(),
    transport,
  });

  await workflow.act({ kind: 'load' });

  assert.deepEqual(workflow.getSnapshot(), {
    kind: 'unavailable',
    message: 'Could not load packet reconciliation',
  });
});

test('one workflow owns choices, exact reconciliation retry, and accepted replacement', async () => {
  const submissions: ReconciliationSubmission[] = [];
  const accepted = workspace([packet('packet-a'), packet('packet-b', 'completed')]);
  let attempts = 0;
  let acceptedNotifications = 0;
  const workflow = createReconciliationWorkflow({
    onAccepted: async () => {
      acceptedNotifications += 1;
    },
    transport: transportWith({
      reconcile: async (submission) => {
        submissions.push(structuredClone(submission));
        attempts += 1;
        return attempts === 1
          ? Response.json({ error: 'Reconciliation changed' }, { status: 409 })
          : Response.json(accepted);
      },
    }),
  });

  await workflow.act({ kind: 'load' });
  await workflow.act({ kind: 'outcome', packetId: 'packet-a', outcome: 'still-here' });
  await workflow.act({ kind: 'outcome', packetId: 'packet-b', outcome: 'taken' });
  await workflow.act({ kind: 'review', reviewing: true });
  await workflow.act({ kind: 'confirm' });

  const rejected = workflow.getSnapshot();
  assert.equal(rejected.kind, 'ready');
  if (rejected.kind !== 'ready') return;
  assert.equal(rejected.feedback?.operation, 'confirm');
  assert.equal(rejected.feedback?.recovery, 'retry');
  assert.equal(rejected.draft.reviewing, true);
  assert.deepEqual(
    [...rejected.draft.outcomes],
    [
      ['packet-a', 'still-here'],
      ['packet-b', 'taken'],
    ],
  );

  await workflow.act({ kind: 'recover', operation: 'confirm' });

  const saved = workflow.getSnapshot();
  assert.equal(saved.kind, 'ready');
  if (saved.kind !== 'ready') return;
  assert.deepEqual(submissions, [submissions[0], submissions[0]]);
  assert.equal(acceptedNotifications, 1);
  assert.deepEqual(saved.accepted, accepted);
  assert.deepEqual([...saved.draft.outcomes], []);
  assert.equal(saved.draft.reviewing, false);
  assert.equal(saved.feedback?.headline, 'Reconciliation saved');
});

test('an uncertain reconciliation locks mutations and reloads instead of replaying', async () => {
  let reconciliations = 0;
  let reloads = 0;
  const workflow = createReconciliationWorkflow({
    onAccepted: () => Promise.resolve(),
    reload: () => {
      reloads += 1;
    },
    transport: transportWith({
      reconcile: async () => {
        reconciliations += 1;
        return Response.json({ unexpected: true });
      },
    }),
  });

  await workflow.act({ kind: 'load' });
  await workflow.act({ kind: 'all-outcomes', outcome: 'taken' });
  await workflow.act({ kind: 'confirm' });
  const uncertain = workflow.getSnapshot();
  assert.equal(uncertain.kind, 'ready');
  if (uncertain.kind !== 'ready') return;
  assert.equal(uncertain.feedback?.recovery, 'reload');
  assert.equal(uncertain.mutationControlsDisabled, true);

  await workflow.act({ kind: 'all-outcomes', outcome: 'discarded' });
  const blocked = workflow.getSnapshot();
  assert.equal(blocked.kind, 'ready');
  if (blocked.kind !== 'ready') return;
  assert.deepEqual(
    [...blocked.draft.outcomes],
    [
      ['packet-a', 'taken'],
      ['packet-b', 'taken'],
    ],
  );
  await workflow.act({ kind: 'recover', operation: 'confirm' });
  assert.equal(reloads, 1);
  assert.equal(reconciliations, 1);
});

test('correction recovery retries the exact whole-packet undo', async () => {
  const attempts: Array<{ packetId: string; coveredOn: string | null }> = [];
  const history = workspace([packet('packet-history', 'completed')]);
  const corrected = workspace([
    { ...packet('packet-history', 'completed'), completedOn: '2026-08-19' },
  ]);
  const restored = workspace([packet('packet-history')]);
  let corrections = 0;
  const workflow = createReconciliationWorkflow({
    onAccepted: () => Promise.resolve(),
    transport: transportWith({
      load: () => Promise.resolve(Response.json(history)),
      correct: async (attempt) => {
        attempts.push({ ...attempt });
        corrections += 1;
        return corrections === 1
          ? Response.json(corrected)
          : corrections === 2
            ? Response.json({ error: 'Reservation conflict' }, { status: 409 })
            : Response.json(restored);
      },
    }),
  });

  await workflow.act({ kind: 'load' });
  await workflow.act({ kind: 'view', view: 'history' });
  await workflow.act({
    kind: 'correct',
    attempt: { packetId: 'packet-history', coveredOn: '2026-08-19' },
  });
  const dateChanged = workflow.getSnapshot();
  assert.equal(dateChanged.kind, 'ready');
  if (dateChanged.kind !== 'ready') return;
  assert.deepEqual(dateChanged.accepted, corrected);
  await workflow.act({
    kind: 'correct',
    attempt: { packetId: 'packet-history', coveredOn: null },
  });
  await workflow.act({
    kind: 'recover',
    operation: 'correction',
    packetId: 'packet-history',
  });

  assert.deepEqual(attempts, [
    { packetId: 'packet-history', coveredOn: '2026-08-19' },
    { packetId: 'packet-history', coveredOn: null },
    { packetId: 'packet-history', coveredOn: null },
  ]);
  const snapshot = workflow.getSnapshot();
  assert.equal(snapshot.kind, 'ready');
  if (snapshot.kind !== 'ready') return;
  assert.deepEqual(snapshot.accepted, restored);
  assert.equal(snapshot.feedback?.headline, 'Packet history updated');
  assert.equal(snapshot.feedback?.operation, 'correction');
});

test('an in-flight reconciliation prevents a second mutation', async () => {
  let finish: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let corrections = 0;
  const workflow = createReconciliationWorkflow({
    onAccepted: () => Promise.resolve(),
    transport: transportWith({
      reconcile: () => pending,
      correct: async () => {
        corrections += 1;
        return Response.json(workspace());
      },
    }),
  });
  await workflow.act({ kind: 'load' });
  await workflow.act({ kind: 'all-outcomes', outcome: 'still-here' });

  const confirmation = workflow.act({ kind: 'confirm' });
  await workflow.act({
    kind: 'correct',
    attempt: { packetId: 'packet-a', coveredOn: null },
  });
  assert.equal(corrections, 0);
  finish(Response.json(workspace()));
  await confirmation;
  assert.equal(corrections, 0);
});
