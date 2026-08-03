import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFinalizedBatchPayload,
  isReconciliationWorkspacePayload,
  isTerritoryWorkspacePayload,
  packetRequestControlsDisabled,
  readMutationResult,
  territoryLeaveControlsDisabled,
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
const territoryWorkspace = {
  id: 'territory-1',
  churchName: 'Grace Church',
  name: 'Northside',
  originAddress: '100 Main St',
  center: [-117.1, 33.5],
  radiusMiles: 2,
  boundaryShape: 'circle',
  import: {
    kind: 'proof',
    release: null,
    center: null,
    radiusMiles: null,
    completedAt: null,
    normalizerVersion: null,
    quality: null,
  },
  apartmentComplexes: [
    {
      id: 'apartment-1',
      sourceId: 'source-apartment-1',
      address: '200 Main St',
      position: [-117.09, 33.51],
      estimatedTracts: 24,
      evidence: { apartmentBuilding: true, distinctUnits: 24 },
      reviewStatus: 'ready',
      withinBoundary: true,
    },
  ],
  segments: [
    {
      id: 'segment-1',
      sourceSegmentId: 'source-segment-1',
      roadGroupId: 'road-1',
      roadClass: 'residential',
      streetName: 'Main St',
      geometry: line,
      estimatedHomes: 12,
      activationKind: 'automatic',
      active: true,
      withinBoundary: true,
      manuallyExcluded: false,
      eligible: true,
      excludedReason: null,
    },
  ],
  totals: { allSegments: 1, eligibleSegments: 1, allHomes: 12, eligibleHomes: 12 },
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
    ['territory workspace', territoryWorkspace, isTerritoryWorkspacePayload],
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
  const partialTerritoryWorkspace = {
    ...territoryWorkspace,
    segments: [{ ...territoryWorkspace.segments[0], geometry: { type: 'LineString' } }],
  };

  for (const [name, payload, validator] of [
    ['finalized batch', partialFinalizedBatch, isFinalizedBatchPayload],
    ['reconciliation workspace', partialReconciliationWorkspace, isReconciliationWorkspacePayload],
    ['territory workspace', partialTerritoryWorkspace, isTerritoryWorkspacePayload],
  ] as const) {
    await context.test(name, async () => {
      const result = await readValidatedPayload(payload, validator);

      assert.deepEqual(result, { status: 'uncertain', recovery: 'reload' });
    });
  }
});

test('packet operation controls lock for every active operation and verification', () => {
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
    assert.equal(packetRequestControlsDisabled(state), true);
  }
  assert.equal(
    packetRequestControlsDisabled({
      downloading: null,
      finalizing: false,
      generating: false,
      verificationRequired: false,
    }),
    false,
  );
});

test('pending-leave controls lock while saving or awaiting reload verification', () => {
  assert.equal(territoryLeaveControlsDisabled({ saving: true, verificationRequired: false }), true);
  assert.equal(territoryLeaveControlsDisabled({ saving: false, verificationRequired: true }), true);
  assert.equal(
    territoryLeaveControlsDisabled({ saving: false, verificationRequired: false }),
    false,
  );
});
