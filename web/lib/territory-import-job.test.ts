import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { TEMECULA_TEST_WORKSPACE, withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import type { ImportedTerritoryInput, OvertureImportStage } from './overture-import.ts';
import { applyMvpCapabilities } from './product-capabilities.ts';
import { territoryDraftFromWorkspace } from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import { createTerritoryImportLifecycle, type TerritoryImportJob } from './territory-import-job.ts';
import { getTerritoryWorkspace } from './territory-persistence.ts';
import { runInWorkspace, type WorkspaceScope } from './workspace-scope.ts';

type Lifecycle = ReturnType<typeof createTerritoryImportLifecycle>;

function importedTerritory(
  draft: Pick<TerritoryDraftInput, 'center' | 'radiusMiles'>,
  overrides: Partial<ImportedTerritoryInput> = {},
): ImportedTerritoryInput {
  const sourceToken = `${draft.center[0]}:${draft.center[1]}`;
  return {
    release: '2026-08-19.0',
    center: draft.center,
    radiusMiles: draft.radiusMiles,
    completedAt: '2026-08-03T12:00:00.000Z',
    normalizerVersion: 12,
    buildingMode: 'overture_only',
    mapBuildings: [],
    apartmentSites: [],
    quality: {
      totalAddresses: 0,
      assignedAddresses: 0,
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
        id: `imported:${sourceToken}:0`,
        sourceSegmentId: `source:${sourceToken}`,
        roadGroupId: `road-group:${sourceToken}`,
        roadClass: 'residential',
        streetName: 'Test Road',
        geometry: {
          type: 'LineString',
          coordinates: [draft.center, [draft.center[0] + 0.0001, draft.center[1]]],
        },
        estimatedHomes: 0,
        activationKind: 'automatic',
        addresses: [],
      },
    ],
    ...overrides,
  };
}

async function withDatabase(operation: (filename: string) => void | Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-import-lifecycle-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();

  try {
    await withTemeculaWorkspace(() => operation(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function importDraft(filename: string): TerritoryDraftInput {
  const draft = territoryDraftFromWorkspace(getTerritoryWorkspace(filename));
  draft.radiusMiles = Math.min(draft.radiusMiles + 0.25, 5);
  return draft;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForStatus(
  lifecycle: Lifecycle,
  status: TerritoryImportJob['status'],
): Promise<ReturnType<Lifecycle['observe']>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = lifecycle.observe();
    if (snapshot.job?.status === status) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Territory import did not reach ${status}`);
}

function insertQueuedJob(filename: string, draft: TerritoryDraftInput, id = 'queued-after-crash') {
  const draftJson = JSON.stringify(draft);
  const database = openDatabase(filename);
  try {
    database
      .prepare(
        `INSERT INTO territory_import_jobs
          (id, church_id, territory_id, draft_json, draft_fingerprint, status, stage)
        VALUES (?, ?, ?, ?, ?, 'queued', 'queued')`,
      )
      .run(
        id,
        TEMECULA_TEST_WORKSPACE.churchId,
        TEMECULA_TEST_WORKSPACE.territoryId,
        draftJson,
        createHash('sha256').update(draftJson).digest('hex'),
      );
    database
      .prepare(`INSERT INTO territory_import_job_events (job_id, stage) VALUES (?, 'queued')`)
      .run(id);
  } finally {
    database.close();
  }
}

function addSecondWorkspace(filename: string): WorkspaceScope {
  const scope = {
    churchId: 'church-second-test',
    territoryId: 'territory-second-test',
    timeZone: 'America/New_York',
  } as const;
  const database = openDatabase(filename);
  try {
    database
      .prepare('INSERT INTO churches (id, name, time_zone) VALUES (?, ?, ?)')
      .run(scope.churchId, 'Second Test Church', scope.timeZone);
    database
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
        SELECT ?, ?, ?, center_latitude + 1, center_longitude + 1, radius_meters,
          boundary_geojson, ?
        FROM territories
        WHERE id = ?`,
      )
      .run(
        scope.territoryId,
        scope.churchId,
        'Second Territory',
        '1 Second Street, Albany, NY',
        TEMECULA_TEST_WORKSPACE.territoryId,
      );
  } finally {
    database.close();
  }
  return scope;
}

test('the lifecycle saves a contained draft without starting another importer', async () => {
  await withDatabase(async (filename) => {
    let imports = 0;
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async (center, radiusMiles) => {
        imports += 1;
        return importedTerritory({ center, radiusMiles });
      },
    });
    lifecycle.save(importDraft(filename));
    await waitForStatus(lifecycle, 'succeeded');
    imports = 0;

    const draft = territoryDraftFromWorkspace(getTerritoryWorkspace(filename));
    draft.boundaryShape = draft.boundaryShape === 'circle' ? 'square' : 'circle';

    const result = lifecycle.save(draft);

    assert.equal(result.kind, 'saved');
    assert.equal(imports, 0);
    assert.equal(getTerritoryWorkspace(filename).boundaryShape, draft.boundaryShape);
  });
});

test('an active import blocks a contained save and remains the only commit', async () => {
  await withDatabase(async (filename) => {
    const initialLifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async (center, radiusMiles) => importedTerritory({ center, radiusMiles }),
    });
    initialLifecycle.save(importDraft(filename));
    await waitForStatus(initialLifecycle, 'succeeded');

    const before = getTerritoryWorkspace(filename);
    const importA = territoryDraftFromWorkspace(before);
    importA.center = [importA.center[0] + 0.01, importA.center[1]];
    const delayed = deferred<ImportedTerritoryInput>();
    let imports = 0;
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async () => {
        imports += 1;
        return delayed.promise;
      },
    });

    const started = lifecycle.save(importA);
    assert.equal(started.kind, 'importing');
    await nextTurn();
    assert.equal(imports, 1);

    const containedB = territoryDraftFromWorkspace(before);
    containedB.radiusMiles -= 0.1;
    containedB.originAddress = 'Contained Draft B';
    assert.deepEqual(lifecycle.save(containedB), {
      kind: 'conflict',
      error: 'Another street data refresh is already running',
    });
    assert.deepEqual(getTerritoryWorkspace(filename), before);

    delayed.resolve(importedTerritory(importA));
    const completed = await waitForStatus(lifecycle, 'succeeded');
    assert.deepEqual(completed.workspace?.center, importA.center);
    assert.equal(completed.workspace?.originAddress, importA.originAddress);
    assert.notEqual(completed.workspace?.originAddress, containedB.originAddress);
  });
});

test('separate lifecycle instances share one claimed process and stages never move backward', async () => {
  await withDatabase(async (filename) => {
    const draft = importDraft(filename);
    const result = deferred<ImportedTerritoryInput>();
    let imports = 0;
    const runImport = async (
      _center: TerritoryDraftInput['center'],
      _radiusMiles: number,
      onStage?: (stage: OvertureImportStage) => void,
    ) => {
      imports += 1;
      onStage?.('matching');
      onStage?.('downloading_buildings');
      onStage?.('preparing');
      return result.promise;
    };
    const firstLifecycle = createTerritoryImportLifecycle({ filename, runImport });
    const replayLifecycle = createTerritoryImportLifecycle({ filename, runImport });

    const [first, replay] = await Promise.all([
      Promise.resolve().then(() => firstLifecycle.save(draft)),
      Promise.resolve().then(() => replayLifecycle.save(structuredClone(draft))),
    ]);
    assert.equal(first.kind, 'importing');
    assert.equal(replay.kind, 'importing');
    if (first.kind !== 'importing' || replay.kind !== 'importing') return;
    assert.equal(replay.job.id, first.job.id);

    await nextTurn();
    assert.equal(imports, 1);
    assert.equal(firstLifecycle.observe().job?.stage, 'preparing');

    const conflictingDraft = { ...draft, originAddress: 'Different Church Address' };
    assert.deepEqual(firstLifecycle.save(conflictingDraft), {
      kind: 'conflict',
      error: 'Another street data refresh is already running',
    });

    const freshProcess = createTerritoryImportLifecycle({
      filename,
      runImport: async () => {
        assert.fail('A fresh observer must not relaunch a running import');
      },
    });
    assert.equal(freshProcess.observe().job?.status, 'running');

    result.resolve(importedTerritory(draft));
    const completed = await waitForStatus(firstLifecycle, 'succeeded');
    assert.equal(completed.workspace?.radiusMiles, draft.radiusMiles);
  });
});

test('equivalent segment sets and legacy apartment statuses reuse one active import', async () => {
  await withDatabase(async (filename) => {
    const firstDraft = importDraft(filename);
    firstDraft.activatedSegmentIds = ['segment:two', 'segment:one'];
    firstDraft.excludedSegmentIds = ['segment:four', 'segment:three'];
    firstDraft.apartmentStatuses = [{ id: 'apartment:one', reviewStatus: 'ready' }];
    const result = deferred<ImportedTerritoryInput>();
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async () => result.promise,
    });

    const first = lifecycle.save(firstDraft);
    assert.equal(first.kind, 'importing');
    if (first.kind !== 'importing') return;
    await nextTurn();

    const equivalentDraft = structuredClone(firstDraft);
    equivalentDraft.activatedSegmentIds.reverse();
    equivalentDraft.excludedSegmentIds.reverse();
    equivalentDraft.apartmentStatuses = [{ id: 'apartment:two', reviewStatus: 'deferred' }];
    const reused = lifecycle.save(equivalentDraft);

    assert.equal(reused.kind, 'importing');
    if (reused.kind !== 'importing') return;
    assert.equal(reused.job.id, first.job.id);
    assert.deepEqual(reused.job.draft, firstDraft);

    result.resolve(importedTerritory(firstDraft));
    await waitForStatus(lifecycle, 'succeeded');
  });
});

test('observe reclaims a queued crash record and failed work retries with a new ID', async () => {
  await withDatabase(async (filename) => {
    const draft = importDraft(filename);
    insertQueuedJob(filename, draft);
    let imports = 0;
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async (center, radiusMiles) => {
        imports += 1;
        if (imports === 1) throw new Error('provider unavailable');
        return importedTerritory({ center, radiusMiles });
      },
    });

    const reclaimed = lifecycle.observe();
    assert.equal(reclaimed.job?.id, 'queued-after-crash');
    assert.equal(reclaimed.job?.status, 'running');
    const failed = await waitForStatus(lifecycle, 'failed');
    assert.equal(
      failed.job?.error,
      'Street data preparation failed. Your previous saved territory is still active.',
    );

    const retry = lifecycle.save(draft);
    assert.equal(retry.kind, 'importing');
    if (retry.kind !== 'importing') return;
    assert.notEqual(retry.job.id, reclaimed.job?.id);
    await waitForStatus(lifecycle, 'succeeded');
    assert.equal(imports, 2);
  });
});

test('invalid fake output and a missing real Python executable fail safely', async (context) => {
  await context.test('invalid fake output', async () => {
    await withDatabase(async (filename) => {
      const before = getTerritoryWorkspace(filename);
      const lifecycle = createTerritoryImportLifecycle({
        filename,
        runImport: async () => {
          throw new Error('Invalid Overture import output');
        },
      });

      lifecycle.save(importDraft(filename));
      const failed = await waitForStatus(lifecycle, 'failed');
      assert.equal(
        failed.job?.error,
        'Street data preparation failed. Your previous saved territory is still active.',
      );
      assert.deepEqual(getTerritoryWorkspace(filename), before);
    });
  });

  await context.test('missing production executable', async () => {
    await withDatabase(async (filename) => {
      const previousPython = process.env.STREETLIGHT_PYTHON;
      process.env.STREETLIGHT_PYTHON = path.join(path.dirname(filename), 'missing-python.exe');
      try {
        const before = getTerritoryWorkspace(filename);
        const lifecycle = createTerritoryImportLifecycle({ filename });
        lifecycle.save(importDraft(filename));
        await waitForStatus(lifecycle, 'failed');
        assert.deepEqual(getTerritoryWorkspace(filename), before);
      } finally {
        if (previousPython === undefined) delete process.env.STREETLIGHT_PYTHON;
        else process.env.STREETLIGHT_PYTHON = previousPython;
      }
    });
  });
});

test('progress write failures do not block atomic success or expose preserved apartments', async () => {
  await withDatabase(async (filename) => {
    const draft = importDraft(filename);
    const database = openDatabase(filename);
    database.exec(`CREATE TRIGGER fail_import_progress
      BEFORE UPDATE OF heartbeat_at ON territory_import_jobs
      WHEN OLD.status = 'running' AND NEW.status = 'running'
      BEGIN
        SELECT RAISE(ABORT, 'progress unavailable');
      END`);
    database.close();
    const imported = importedTerritory(draft, {
      apartmentSites: [
        {
          id: 'site:address-only',
          sourceId: 'landuse:test',
          name: null,
          address: '10 Apartment Way',
          position: draft.center,
          boundary: null,
          groupingKind: 'ungrouped',
          members: [
            {
              id: 'evidence:address-only',
              sourceId: 'address:test',
              address: '10 Apartment Way',
              position: draft.center,
              geometry: null,
              apartmentBuilding: false,
              distinctUnits: 5,
            },
          ],
        },
      ],
    });
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async (_center, _radius, onStage) => {
        onStage?.('downloading_buildings');
        onStage?.('matching');
        onStage?.('preparing');
        return imported;
      },
    });

    lifecycle.save(draft);
    const completed = await waitForStatus(lifecycle, 'succeeded');
    assert.equal(completed.workspace?.apartmentSites.length, 1);
    assert.ok(completed.workspace);
    assert.deepEqual(applyMvpCapabilities(completed.workspace).apartmentSites, []);
    assert.equal(getTerritoryWorkspace(filename).apartmentSites.length, 1);
  });
});

test('a forced completion rollback preserves the prior region and history', async () => {
  await withDatabase(async (filename) => {
    const before = getTerritoryWorkspace(filename);
    const draft = importDraft(filename);
    const invalid = importedTerritory(draft);
    invalid.segments.push(structuredClone(invalid.segments[0]));
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async () => invalid,
    });

    lifecycle.save(draft);
    await waitForStatus(lifecycle, 'failed');

    assert.deepEqual(getTerritoryWorkspace(filename), before);
  });
});

test('stale interruption rejects late completion and leaves the prior region active', async () => {
  await withDatabase(async (filename) => {
    const before = getTerritoryWorkspace(filename);
    const draft = importDraft(filename);
    const delayed = deferred<ImportedTerritoryInput>();
    const originalProcess = createTerritoryImportLifecycle({
      filename,
      runImport: async () => delayed.promise,
    });
    const started = originalProcess.save(draft);
    assert.equal(started.kind, 'importing');

    const restartedProcess = createTerritoryImportLifecycle({
      filename,
      now: () => Date.now() + 2 * 60_000,
      runImport: async () => assert.fail('A running crash record must not relaunch'),
    });
    assert.equal(restartedProcess.observe().job?.status, 'interrupted');

    delayed.resolve(importedTerritory(draft));
    await nextTurn();
    await nextTurn();
    assert.equal(restartedProcess.observe().job?.status, 'interrupted');
    assert.deepEqual(getTerritoryWorkspace(filename), before);

    const retryProcess = createTerritoryImportLifecycle({
      filename,
      runImport: async () => importedTerritory(draft),
    });
    const retry = retryProcess.save(draft);
    assert.equal(retry.kind, 'importing');
    if (retry.kind !== 'importing' || started.kind !== 'importing') return;
    assert.notEqual(retry.job.id, started.job.id);
    await waitForStatus(retryProcess, 'succeeded');
  });
});

test('workspace scope isolates recovery and initial setup unlocks only after success', async () => {
  await withDatabase(async (filename) => {
    const secondScope = addSecondWorkspace(filename);
    const firstDraft = importDraft(filename);
    insertQueuedJob(filename, firstDraft);
    let imports = 0;
    const lifecycle = createTerritoryImportLifecycle({
      filename,
      runImport: async (center, radiusMiles) => {
        imports += 1;
        return importedTerritory({ center, radiusMiles });
      },
    });

    const otherChurchView = runInWorkspace(secondScope, () => lifecycle.observe());
    assert.deepEqual(otherChurchView, { job: null, workspace: null });
    assert.equal(imports, 0);

    lifecycle.observe();
    await waitForStatus(lifecycle, 'succeeded');
    assert.equal(imports, 1);

    await runInWorkspace(secondScope, async () => {
      const draft = territoryDraftFromWorkspace(getTerritoryWorkspace(filename));
      draft.radiusMiles = 1;
      const started = lifecycle.save(draft);
      assert.equal(started.kind, 'importing');
      const before = openDatabase(filename);
      assert.equal(
        (
          before
            .prepare('SELECT onboarding_completed_at FROM churches WHERE id = ?')
            .get(secondScope.churchId) as { onboarding_completed_at: string | null }
        ).onboarding_completed_at,
        null,
      );
      before.close();

      await waitForStatus(lifecycle, 'succeeded');
      const after = openDatabase(filename);
      assert.notEqual(
        (
          after
            .prepare('SELECT onboarding_completed_at FROM churches WHERE id = ?')
            .get(secondScope.churchId) as { onboarding_completed_at: string | null }
        ).onboarding_completed_at,
        null,
      );
      after.close();
    });
  });
});

test('migration enforces one active territory import per church', async () => {
  await withDatabase((filename) => {
    const draft = importDraft(filename);
    insertQueuedJob(filename, draft, 'first-active');
    const database = openDatabase(filename);
    try {
      assert.throws(() => {
        database
          .prepare(
            `INSERT INTO territory_import_jobs
              (id, church_id, territory_id, draft_json, draft_fingerprint, status, stage)
            VALUES (?, ?, ?, ?, ?, 'queued', 'queued')`,
          )
          .run(
            'second-active',
            TEMECULA_TEST_WORKSPACE.churchId,
            TEMECULA_TEST_WORKSPACE.territoryId,
            JSON.stringify(draft),
            'different-fingerprint',
          );
      }, /UNIQUE/);
    } finally {
      database.close();
    }
  });
});
