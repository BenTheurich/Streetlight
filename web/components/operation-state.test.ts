import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctionControlForPacket,
  focusFinalizationConfirmation,
  isFinalizedBatchPayload,
  isReconciliationWorkspacePayload,
  packetOperationControls,
  readMutationResult,
  reconciliationMutationControlsDisabled,
  restoreFinalizationTrigger,
} from './operation-state.ts';

const line = {
  type: 'LineString',
  coordinates: [
    [-117.1, 33.5],
    [-117.09, 33.51],
  ],
};
const packetSegment = { id: 'segment-1', geometry: line, estimatedHomes: 12 };
const start = { address: '100 Main St', position: [-117.1, 33.5] };
const finalizedPacket = {
  id: 'packet-1',
  code: 'A-001',
  targetHomes: 12,
  estimatedHomes: 12,
  coverageClass: 'red',
  segments: [packetSegment],
  start,
  streetNames: ['Main St'],
};
const finalizedBatch = {
  id: 'batch-1',
  name: 'August outreach',
  finalizedAt: '2026-08-01T12:00:00.000Z',
  packetCount: 1,
  estimatedHomes: 12,
  packets: [finalizedPacket],
};
const reconciliationWorkspace = {
  asOf: '2026-08-01',
  defaultBatchId: 'batch-1',
  batches: [
    {
      id: 'batch-1',
      name: 'August outreach',
      status: 'finalized',
      finalizedAt: '2026-08-01T12:00:00.000Z',
      packets: [
        {
          id: 'packet-1',
          code: 'A-001',
          kind: 'street',
          status: 'active',
          estimatedTracts: 12,
          start,
          segments: [packetSegment],
          apartment: null,
          completedOn: null,
          history: [],
        },
      ],
      counts: { active: 1, completed: 0, cancelled: 0 },
    },
  ],
};
type SavedRecord = { id: string };

function isSavedRecord(value: unknown): value is SavedRecord {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string',
  );
}

function readValidatedPayload(payload: unknown, validator: (value: unknown) => boolean) {
  return readMutationResult<unknown>(
    () => Promise.resolve(Response.json(payload, { status: 200 })),
    (value): value is unknown => validator(value),
  );
}

test('a confirmed server rejection preserves its message and permits a retry', async () => {
  const result = await readMutationResult(
    () => Promise.resolve(Response.json({ error: 'Packet proposals changed' }, { status: 409 })),
    isSavedRecord,
  );

  assert.deepEqual(result, {
    status: 'rejected',
    message: 'Packet proposals changed',
    recovery: 'retry',
  });
});

test('a lost or invalid mutation response requires reload verification', async (context) => {
  await context.test('when the request rejects', async () => {
    const result = await readMutationResult(
      () => Promise.reject(new TypeError('network connection lost')),
      isSavedRecord,
    );

    assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
  });

  await context.test('when a successful response has an invalid body', async () => {
    const result = await readMutationResult(
      () => Promise.resolve(Response.json({ unexpected: true }, { status: 201 })),
      isSavedRecord,
    );

    assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
  });

  await context.test('when a rejection has no valid server message', async () => {
    const result = await readMutationResult(
      () => Promise.resolve(new Response('gateway failure', { status: 502 })),
      isSavedRecord,
    );

    assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
  });

  await context.test('when a server error has a JSON message', async () => {
    const result = await readMutationResult(
      () => Promise.resolve(Response.json({ error: 'Database unavailable' }, { status: 500 })),
      isSavedRecord,
    );

    assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
  });
});

test('a valid successful mutation response returns its body', async () => {
  const result = await readMutationResult(
    () => Promise.resolve(Response.json({ id: 'saved-record' }, { status: 201 })),
    isSavedRecord,
  );

  assert.deepEqual(result, { status: 'success', value: { id: 'saved-record' } });
});

test('complete mutation payloads pass their production validators', async (context) => {
  for (const [name, payload, validator] of [
    ['finalized batch', finalizedBatch, isFinalizedBatchPayload],
    ['reconciliation workspace', reconciliationWorkspace, isReconciliationWorkspacePayload],
  ] as const) {
    await context.test(name, async () => {
      const result = await readValidatedPayload(payload, validator);

      assert.equal(result.status, 'success');
    });
  }
});

test('partial mutation payloads require reload verification', async (context) => {
  const partialFinalizedBatch = {
    ...finalizedBatch,
    packets: [{ ...finalizedPacket, start: { address: '100 Main St' } }],
  };
  const partialReconciliationWorkspace = {
    ...reconciliationWorkspace,
    batches: [
      {
        ...reconciliationWorkspace.batches[0],
        packets: [{ ...reconciliationWorkspace.batches[0].packets[0], apartment: {} }],
      },
    ],
  };
  for (const [name, payload, validator] of [
    ['finalized batch', partialFinalizedBatch, isFinalizedBatchPayload],
    ['reconciliation workspace', partialReconciliationWorkspace, isReconciliationWorkspacePayload],
  ] as const) {
    await context.test(name, async () => {
      const result = await readValidatedPayload(payload, validator);

      assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
    });
  }
});

test('packet confirmation transfers focus in and restores its trigger on cancel', () => {
  const focused: string[] = [];
  const confirmation = { focus: () => focused.push('confirmation') };
  const trigger = { focus: () => focused.push('trigger') };

  focusFinalizationConfirmation(false, confirmation);
  focusFinalizationConfirmation(true, confirmation);
  restoreFinalizationTrigger(trigger, (callback) => callback());

  assert.deepEqual(focused, ['confirmation', 'trigger']);
});

test('one packet operation control projection locks every mutation and PDF entry point', () => {
  for (const state of [
    {
      downloading: null,
      finalizing: false,
      generating: true,
      verificationRequired: false,
    },
    {
      downloading: null,
      finalizing: true,
      generating: false,
      verificationRequired: false,
    },
    {
      downloading: 'newest' as const,
      finalizing: false,
      generating: false,
      verificationRequired: false,
    },
    {
      downloading: null,
      finalizing: false,
      generating: false,
      verificationRequired: true,
    },
  ]) {
    assert.deepEqual(packetOperationControls(state, 3), {
      activePdfDisabled: true,
      busy: true,
      finalizationDisabled: true,
      newestPdfDisabled: true,
      proposalDisabled: true,
      requestDisabled: true,
    });
  }
  assert.deepEqual(
    packetOperationControls(
      {
        downloading: null,
        finalizing: false,
        generating: false,
        verificationRequired: false,
      },
      0,
    ),
    {
      activePdfDisabled: true,
      busy: false,
      finalizationDisabled: false,
      newestPdfDisabled: false,
      proposalDisabled: false,
      requestDisabled: false,
    },
  );
  assert.equal(
    packetOperationControls(
      { downloading: null, finalizing: false, generating: false, verificationRequired: false },
      3,
    ).activePdfDisabled,
    false,
  );
});

test('correction recovery stays with one packet and retries the exact attempt', () => {
  const attempt = { packetId: 'packet-a', coveredOn: '2026-07-20' };
  const rejected = {
    attempt,
    detail: 'Date rejected',
    headline: 'Packet history was not changed',
    operation: 'correction' as const,
    recovery: 'retry' as const,
    tone: 'error' as const,
  };

  assert.deepEqual(correctionControlForPacket('packet-a', null, rejected), {
    action: { kind: 'retry', attempt },
    busy: false,
    feedback: rejected,
  });
  assert.deepEqual(correctionControlForPacket('packet-b', null, rejected), {
    action: null,
    busy: false,
    feedback: null,
  });
  assert.equal(reconciliationMutationControlsDisabled(false, 'retry'), false);

  const uncertain = { ...rejected, recovery: 'reload' as const };
  assert.deepEqual(correctionControlForPacket('packet-a', null, uncertain), {
    action: { kind: 'reload' },
    busy: false,
    feedback: uncertain,
  });
  assert.deepEqual(correctionControlForPacket('packet-b', null, uncertain), {
    action: null,
    busy: false,
    feedback: null,
  });
  assert.equal(reconciliationMutationControlsDisabled(false, 'reload'), true);
  assert.equal(reconciliationMutationControlsDisabled(true, undefined), true);
  assert.equal(correctionControlForPacket('packet-a', attempt, null).busy, true);
  assert.equal(reconciliationMutationControlsDisabled(false, undefined), false);
});
