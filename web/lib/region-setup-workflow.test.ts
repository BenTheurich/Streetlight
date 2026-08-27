import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRegionSetupWorkflow,
  type RegionSetupScheduler,
  type RegionSetupTransport,
} from './region-setup-workflow.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import type { TerritoryWorkspace } from './territory-workspace.ts';

const workspace: TerritoryWorkspace = {
  id: 'territory-one',
  churchName: 'Sample Church',
  name: 'Outreach Region',
  originAddress: '1 Sample Road',
  center: [-117.15, 33.5],
  radiusMiles: 2,
  boundaryShape: 'circle',
  import: {
    kind: 'overture',
    release: '2026-08-19.0',
    center: [-117.15, 33.5],
    radiusMiles: 3,
    completedAt: '2026-08-25T10:00:00.000Z',
    normalizerVersion: 12,
    quality: {
      totalAddresses: 1,
      assignedAddresses: 1,
      spatiallyAssignedAddresses: 0,
      inferredRoads: 0,
      unmatchedAddresses: 0,
      unresolvedClusters: 0,
      totalResidentialBuildings: 1,
      fallbackBuildings: 0,
      unmatchedResidentialBuildings: 0,
      populatedUnnamedRoads: 0,
      buildingAddressDisagreements: 0,
      warnings: [],
    },
  },
  apartmentSites: [],
  apartmentComplexes: [],
  segments: [
    {
      id: 'segment-one',
      sourceSegmentId: 'source-one',
      roadGroupId: 'road-one',
      roadClass: 'residential',
      streetName: 'Sample Road',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.15, 33.5],
          [-117.149, 33.501],
        ],
      },
      estimatedHomes: 4,
      activationKind: 'automatic',
      active: true,
      withinBoundary: true,
      manuallyExcluded: false,
      eligible: true,
      excludedReason: null,
    },
    {
      id: 'segment-two',
      sourceSegmentId: 'source-two',
      roadGroupId: 'road-two',
      roadClass: 'service',
      streetName: 'Hidden Road',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.151, 33.5],
          [-117.152, 33.501],
        ],
      },
      estimatedHomes: 0,
      activationKind: 'hidden',
      active: false,
      withinBoundary: true,
      manuallyExcluded: false,
      eligible: false,
      excludedReason: 'hidden',
    },
  ],
  totals: { allSegments: 2, eligibleSegments: 1, allHomes: 4, eligibleHomes: 4 },
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function manualScheduler(): RegionSetupScheduler & {
  runNext(): void;
  readonly delays: number[];
  readonly pending: number;
} {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  return {
    schedule(callback, delayMs) {
      callbacks.push(callback);
      delays.push(delayMs);
      return callback;
    },
    cancel(handle) {
      const index = callbacks.indexOf(handle as () => void);
      if (index >= 0) callbacks.splice(index, 1);
    },
    runNext() {
      callbacks.shift()?.();
    },
    delays,
    get pending() {
      return callbacks.length;
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('the workflow owns accepted versus draft state and exact edits', async () => {
  const transport: RegionSetupTransport = {
    loadTerritory: async () => json(workspace),
    saveTerritory: async () => json(workspace),
    observeImport: async () => json({ job: null, workspace: null }),
    resolveAddress: async () =>
      json({ formattedAddress: '2 Sample Road', center: [-117.14, 33.51] }),
    saveApartmentConfiguration: async () => json(workspace),
    saveApartmentMembership: async () => json(workspace),
  };
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport,
    scheduler: manualScheduler(),
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });

  const stop = workflow.start();
  await settle();
  assert.equal(workflow.getSnapshot().kind, 'ready');

  workflow.edit({ kind: 'segments', ids: ['segment-two'], disposition: 'activate' });
  workflow.edit({ kind: 'segments', ids: ['segment-one'], disposition: 'exclude' });
  workflow.edit({ kind: 'segments', ids: ['segment-one'], disposition: 'restore' });
  workflow.edit({ kind: 'shape', boundaryShape: 'square' });
  workflow.edit({ kind: 'radius', radiusMiles: 1.5 });
  workflow.edit({
    kind: 'location',
    originAddress: '2 Sample Road',
    center: [-117.14, 33.51],
  });
  const edited = workflow.getSnapshot();
  assert.equal(edited.kind, 'ready');
  assert.equal(edited.dirty, true);
  assert.equal(edited.leaveProtection, 'confirm');
  assert.deepEqual(edited.draft.activatedSegmentIds, ['segment-two']);
  assert.deepEqual(edited.draft.excludedSegmentIds, []);
  assert.equal(edited.draft.boundaryShape, 'square');
  assert.equal(edited.draft.radiusMiles, 1.5);
  assert.equal(edited.draft.originAddress, '2 Sample Road');
  assert.deepEqual(edited.draft.center, [-117.14, 33.51]);
  assert.equal(edited.displayed.segments.find(({ id }) => id === 'segment-two')?.active, true);

  stop();
});

function draftWithRadius(radiusMiles: number): TerritoryDraftInput {
  return {
    originAddress: workspace.originAddress,
    center: workspace.center,
    radiusMiles,
    boundaryShape: workspace.boundaryShape,
    activatedSegmentIds: [],
    excludedSegmentIds: [],
    apartmentStatuses: [],
  };
}

function importJob(
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted',
  stage:
    | 'queued'
    | 'downloading_streets'
    | 'downloading_buildings'
    | 'matching'
    | 'preparing'
    | 'saving',
  draft = draftWithRadius(4),
  id = 'job-one',
) {
  return {
    id,
    status,
    stage,
    draft,
    error: status === 'failed' ? 'Street data preparation failed safely.' : null,
    createdAt: '2026-08-25 10:01:00',
    updatedAt: '2026-08-25 10:01:01',
  };
}

function savedWorkspace(radiusMiles: number): TerritoryWorkspace {
  return {
    ...structuredClone(workspace),
    radiusMiles,
    import: {
      ...structuredClone(workspace.import),
      radiusMiles: Math.max(radiusMiles, 4),
      completedAt: '2026-08-25T10:02:00.000Z',
    },
  };
}

test('a contained save adopts the confirmed workspace before refreshing its host', async () => {
  const calls: string[] = [];
  const accepted = savedWorkspace(1);
  const transport: RegionSetupTransport = {
    loadTerritory: async () => json(workspace),
    saveTerritory: async (draft) => {
      calls.push(`save:${draft.radiusMiles}`);
      return json(accepted);
    },
    observeImport: async () => json({ job: null, workspace: null }),
    resolveAddress: async () => json({}),
    saveApartmentConfiguration: async () => {
      calls.push('apartment');
      return json(workspace);
    },
    saveApartmentMembership: async () => {
      calls.push('apartment');
      return json(workspace);
    },
  };
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport,
    scheduler: manualScheduler(),
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async ({ refreshMapData }) => {
      const snapshot = workflow.getSnapshot();
      assert.equal(snapshot.kind, 'ready');
      assert.equal(snapshot.accepted.radiusMiles, 1);
      assert.equal(snapshot.dirty, false);
      assert.equal(refreshMapData, false);
      calls.push('refresh');
    },
    onLeaveReady: () => calls.push('leave'),
  });
  const stop = workflow.start();
  await settle();

  workflow.edit({ kind: 'radius', radiusMiles: 1 });
  await workflow.save('leave');
  assert.deepEqual(calls, ['save:1', 'refresh', 'leave']);
  const result = workflow.getSnapshot();
  assert.equal(result.kind, 'ready');
  assert.equal(result.operation.kind, 'idle');
  assert.equal(result.notice, 'Region changes saved.');
  stop();
});

test('an established import preserves the accepted region and reports monotonic progress', async () => {
  const scheduler = manualScheduler();
  const observations = [
    json({ job: null, workspace: null }),
    json({ job: importJob('running', 'matching'), workspace: null }),
    json({ job: importJob('running', 'downloading_buildings'), workspace: null }),
    json({ job: importJob('succeeded', 'saving'), workspace: savedWorkspace(4) }),
  ];
  let leaveCount = 0;
  const transport: RegionSetupTransport = {
    loadTerritory: async () => json(workspace),
    saveTerritory: async () => json({ job: importJob('running', 'downloading_streets') }, 202),
    observeImport: async () => observations.shift() ?? json({ job: null, workspace: null }),
    resolveAddress: async () => json({}),
    saveApartmentConfiguration: async () => json(workspace),
    saveApartmentMembership: async () => json(workspace),
  };
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport,
    scheduler,
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async ({ refreshMapData }) => assert.equal(refreshMapData, true),
    onLeaveReady: () => {
      leaveCount += 1;
    },
  });
  const stop = workflow.start();
  await settle();
  assert.equal(observations.length, 3);
  workflow.edit({ kind: 'radius', radiusMiles: 4 });
  await workflow.save('leave');

  let current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.accepted.radiusMiles, 2);
  assert.equal(current.operation.kind, 'importing');
  assert.equal(leaveCount, 1);

  scheduler.runNext();
  await settle();
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.deepEqual(current.operation, {
    kind: 'importing',
    stage: 'matching',
    placement: 'global',
  });

  scheduler.runNext();
  await settle();
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.deepEqual(current.operation, {
    kind: 'importing',
    stage: 'matching',
    placement: 'global',
  });

  scheduler.runNext();
  await settle();
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.accepted.radiusMiles, 4);
  assert.equal(current.operation.kind, 'completed');
  assert.equal(leaveCount, 1);
  stop();
});

test('initial setup stays locked until an import succeeds and then unlocks once', async () => {
  const scheduler = manualScheduler();
  const observations = [
    json({ job: null, workspace: null }),
    json({ job: importJob('succeeded', 'saving'), workspace: savedWorkspace(4) }),
  ];
  const acceptedEvents: unknown[] = [];
  let leaveCount = 0;
  const workflow = createRegionSetupWorkflow({
    initialSetup: true,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json({ job: importJob('queued', 'queued') }, 202),
      observeImport: async () => observations.shift() ?? json({ job: null, workspace: null }),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler,
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async (event) => {
      acceptedEvents.push(event);
    },
    onLeaveReady: () => {
      leaveCount += 1;
    },
  });
  const stop = workflow.start();
  await settle();
  assert.equal(observations.length, 1);
  workflow.edit({ kind: 'radius', radiusMiles: 4 });
  await workflow.save('leave');
  let current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.setupRequired, true);
  assert.equal(leaveCount, 0);

  scheduler.runNext();
  await settle();
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.setupRequired, false);
  assert.deepEqual(acceptedEvents, [{ refreshMapData: true, completedInitialSetup: true }]);
  assert.equal(leaveCount, 1);
  stop();
});

test('refresh reconnect adopts the active job draft without replacing the prior region', async () => {
  const scheduler = manualScheduler();
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => {
        throw new Error('save is not expected');
      },
      observeImport: async () => json({ job: importJob('running', 'preparing'), workspace: null }),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler,
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();
  const current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.accepted.radiusMiles, 2);
  assert.equal(current.draft.radiusMiles, 4);
  assert.deepEqual(current.operation, {
    kind: 'importing',
    stage: 'preparing',
    placement: 'global',
  });
  assert.equal(scheduler.pending, 1);
  stop();
});

test('confirmed rejection retries the exact attempted draft', async () => {
  const attempted: TerritoryDraftInput[] = [];
  let saveCount = 0;
  let leaveCount = 0;
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async (draft) => {
        attempted.push(structuredClone(draft));
        saveCount += 1;
        return saveCount === 1
          ? json({ error: 'Draft was rejected' }, 400)
          : json(savedWorkspace(1));
      },
      observeImport: async () => json({ job: null, workspace: null }),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler: manualScheduler(),
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async () => undefined,
    onLeaveReady: () => {
      leaveCount += 1;
    },
  });
  const stop = workflow.start();
  await settle();
  workflow.edit({ kind: 'radius', radiusMiles: 1 });
  await workflow.save('stay');
  let current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.deepEqual(current.operation, {
    kind: 'failed',
    target: 'contained',
    message: 'Draft was rejected',
    recovery: 'retry',
    placement: 'surface',
  });
  await workflow.save('leave');
  const expectedAttempt = { ...draftWithRadius(1) };
  delete (expectedAttempt as Partial<TerritoryDraftInput>).apartmentStatuses;
  assert.deepEqual(attempted, [expectedAttempt, expectedAttempt]);
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.dirty, false);
  assert.equal(leaveCount, 1);
  stop();
});

test('network, server, and malformed success outcomes require reload verification', async (t) => {
  const failures: Array<() => Promise<Response>> = [
    async () => {
      throw new Error('network');
    },
    async () => json({ error: 'server' }, 500),
    async () => json({ saved: true }),
  ];

  for (const [index, saveTerritory] of failures.entries()) {
    await t.test(String(index), async () => {
      let reloads = 0;
      const workflow = createRegionSetupWorkflow({
        initialSetup: false,
        transport: {
          loadTerritory: async () => json(workspace),
          saveTerritory,
          observeImport: async () => json({ job: null, workspace: null }),
          resolveAddress: async () => json({}),
          saveApartmentConfiguration: async () => json(workspace),
          saveApartmentMembership: async () => json(workspace),
        },
        scheduler: manualScheduler(),
        reload: () => {
          reloads += 1;
        },
        onAccepted: async () => undefined,
        onLeaveReady: () => undefined,
      });
      const stop = workflow.start();
      await settle();
      workflow.edit({ kind: 'radius', radiusMiles: 1 });
      await workflow.save('stay');
      const current = workflow.getSnapshot();
      assert.equal(current.kind, 'ready');
      assert.equal(current.operation.kind, 'failed');
      assert.equal(current.operation.recovery, 'reload');
      assert.equal(current.mutationLocked, true);
      await workflow.recover();
      assert.equal(reloads, 1);
      stop();
    });
  }
});

test('failed and interrupted imports preserve the prior region and retry with a new save', async (t) => {
  for (const status of ['failed', 'interrupted'] as const) {
    await t.test(status, async () => {
      const scheduler = manualScheduler();
      let saves = 0;
      const observations = [
        json({ job: null, workspace: null }),
        json({ job: importJob(status, 'matching', draftWithRadius(4), 'job-1'), workspace: null }),
      ];
      const workflow = createRegionSetupWorkflow({
        initialSetup: false,
        transport: {
          loadTerritory: async () => json(workspace),
          saveTerritory: async () => {
            saves += 1;
            return json(
              {
                job: importJob(
                  'running',
                  'downloading_streets',
                  draftWithRadius(4),
                  `job-${saves}`,
                ),
              },
              202,
            );
          },
          observeImport: async () => observations.shift() ?? json({ job: null, workspace: null }),
          resolveAddress: async () => json({}),
          saveApartmentConfiguration: async () => json(workspace),
          saveApartmentMembership: async () => json(workspace),
        },
        scheduler,
        reload: () => assert.fail('reload is not expected'),
        onAccepted: async () => undefined,
        onLeaveReady: () => undefined,
      });
      const stop = workflow.start();
      await settle();
      workflow.edit({ kind: 'radius', radiusMiles: 4 });
      await workflow.save('stay');
      scheduler.runNext();
      await settle();
      const failed = workflow.getSnapshot();
      assert.equal(failed.kind, 'ready');
      assert.equal(failed.accepted.radiusMiles, 2);
      assert.equal(failed.operation.kind, 'failed');
      assert.equal(failed.operation.recovery, 'retry');
      await workflow.recover();
      assert.equal(saves, 2);
      stop();
    });
  }
});

test('transient polling recovers, but a missing tracked job requires reload', async () => {
  const scheduler = manualScheduler();
  const observations: Array<() => Promise<Response>> = [
    async () => json({ job: null, workspace: null }),
    async () => {
      throw new Error('temporary');
    },
    async () => json({ job: importJob('running', 'matching'), workspace: null }),
    async () => json({ job: null, workspace: null }),
  ];
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json({ job: importJob('running', 'downloading_streets') }, 202),
      observeImport: async () =>
        (observations.shift() ?? (() => Promise.resolve(json({ job: null }))))(),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler,
    reload: () => undefined,
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();
  workflow.edit({ kind: 'radius', radiusMiles: 4 });
  await workflow.save('stay');

  scheduler.runNext();
  await settle();
  assert.equal(scheduler.delays.at(-1), 3_000);
  scheduler.runNext();
  await settle();
  let current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.operation.kind, 'importing');
  scheduler.runNext();
  await settle();
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.operation.kind, 'failed');
  assert.equal(current.operation.recovery, 'reload');
  stop();
});

test('initial observation retries before discovering a persisted running job', async () => {
  const scheduler = manualScheduler();
  const observations: Array<() => Promise<Response>> = [
    async () => {
      throw new Error('temporary');
    },
    async () => json({ job: importJob('running', 'preparing'), workspace: null }),
  ];
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json(workspace),
      observeImport: async () =>
        (observations.shift() ?? (() => Promise.resolve(json({ job: null }))))(),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler,
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();
  assert.equal(scheduler.pending, 1);
  assert.equal(scheduler.delays.at(-1), 3_000);

  scheduler.runNext();
  await settle();
  const current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.accepted.radiusMiles, 2);
  assert.equal(current.draft.radiusMiles, 4);
  assert.deepEqual(current.operation, {
    kind: 'importing',
    stage: 'preparing',
    placement: 'global',
  });
  assert.equal(scheduler.pending, 1);
  assert.equal(scheduler.delays.at(-1), 1_500);
  stop();
});

test('a host refresh failure never rolls back an accepted save', async () => {
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json(savedWorkspace(1)),
      observeImport: async () => json({ job: null, workspace: null }),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler: manualScheduler(),
    reload: () => undefined,
    onAccepted: async () => {
      throw new Error('coverage refresh failed');
    },
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();
  workflow.edit({ kind: 'radius', radiusMiles: 1 });
  await workflow.save('stay');
  const current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.accepted.radiusMiles, 1);
  assert.equal(current.dirty, false);
  assert.equal(
    current.notice,
    'Region saved, but coverage could not refresh. Reload the page to retry.',
  );
  stop();
});

test('disconnect ignores a late territory response and cancels scheduled polling', async () => {
  let resolveLoad: (response: Response) => void = () => assert.fail('load resolver missing');
  const load = new Promise<Response>((resolve) => {
    resolveLoad = resolve;
  });
  let accepted = 0;
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: () => load,
      saveTerritory: async () => json(workspace),
      observeImport: async () => json({ job: null, workspace: null }),
      resolveAddress: async () => json({}),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler: manualScheduler(),
    reload: () => undefined,
    onAccepted: async () => {
      accepted += 1;
    },
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  stop();
  resolveLoad(json(workspace));
  await settle();
  assert.deepEqual(workflow.getSnapshot(), { kind: 'loading', operation: { kind: 'idle' } });
  assert.equal(accepted, 0);
});

test('a newer address lookup wins and disconnect ignores late geocoding', async () => {
  const resolvers: Array<(response: Response) => void> = [];
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json(workspace),
      observeImport: async () => json({ job: null, workspace: null }),
      resolveAddress: () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
      saveApartmentConfiguration: async () => json(workspace),
      saveApartmentMembership: async () => json(workspace),
    },
    scheduler: manualScheduler(),
    reload: () => assert.fail('reload is not expected'),
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();

  const first = workflow.resolveAddress('First');
  const second = workflow.resolveAddress('Second');
  resolvers[1]?.(json({ formattedAddress: 'Second result', center: [-117.14, 33.51] }));
  assert.equal((await second).ok, true);
  resolvers[0]?.(json({ formattedAddress: 'Stale result', center: [-117.13, 33.52] }));
  assert.deepEqual(await first, { ok: false, message: 'Address lookup was cancelled.' });
  let current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.addressLookup.kind, 'candidate');
  assert.equal(current.addressLookup.candidate.formattedAddress, 'Second result');

  const disconnected = workflow.resolveAddress('After disconnect');
  stop();
  resolvers[2]?.(json({ formattedAddress: 'Late result', center: [-117.12, 33.53] }));
  assert.deepEqual(await disconnected, {
    ok: false,
    message: 'Address lookup was cancelled.',
  });
  current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.equal(current.addressLookup.kind, 'looking');
});

test('manual geocoding owns its candidate state and apartments make no calls while disabled', async () => {
  let apartmentCalls = 0;
  const workflow = createRegionSetupWorkflow({
    initialSetup: false,
    transport: {
      loadTerritory: async () => json(workspace),
      saveTerritory: async () => json(workspace),
      observeImport: async () => json({ job: null, workspace: null }),
      resolveAddress: async () =>
        json({ formattedAddress: '2 Sample Road', center: [-117.14, 33.51] }),
      saveApartmentConfiguration: async () => {
        apartmentCalls += 1;
        return json(workspace);
      },
      saveApartmentMembership: async () => {
        apartmentCalls += 1;
        return json(workspace);
      },
    },
    scheduler: manualScheduler(),
    reload: () => undefined,
    onAccepted: async () => undefined,
    onLeaveReady: () => undefined,
  });
  const stop = workflow.start();
  await settle();
  const result = await workflow.resolveAddress('2 Sample Road');
  assert.deepEqual(result, {
    ok: true,
    candidate: { formattedAddress: '2 Sample Road', center: [-117.14, 33.51] },
  });
  const current = workflow.getSnapshot();
  assert.equal(current.kind, 'ready');
  assert.deepEqual(current.addressLookup, {
    kind: 'candidate',
    candidate: { formattedAddress: '2 Sample Road', center: [-117.14, 33.51] },
  });
  assert.equal(workflow.apartments, null);
  assert.equal(current.apartment, null);
  assert.equal(apartmentCalls, 0);
  stop();
});
