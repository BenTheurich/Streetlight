import { createHash, randomUUID } from 'node:crypto';
import {
  type ImportedTerritoryInput,
  type OvertureImportStage,
  runOvertureImport,
} from './overture-import.ts';
import { openSqliteDatabase } from './sqlite-persistence.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from './territory-draft.ts';
import { needsTerritoryImport } from './territory-import.ts';
import {
  getTerritoryWorkspace,
  replaceTerritoryFromImport,
  saveTerritoryDraft,
  TerritoryImportActiveError,
} from './territory-persistence.ts';
import type { TerritoryWorkspace } from './territory-workspace.ts';
import { requireWorkspaceScope, runInWorkspace, type WorkspaceScope } from './workspace-scope.ts';

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 60_000;
const SAFE_FAILURE =
  'Street data preparation failed. Your previous saved territory is still active.';
const ACTIVE_IMPORT_CONFLICT = 'Another street data refresh is already running';

export type TerritoryImportStage =
  | 'queued'
  | 'downloading_streets'
  | 'downloading_buildings'
  | 'matching'
  | 'preparing'
  | 'saving';

type TerritoryImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';

export type TerritoryImportJob = {
  id: string;
  status: TerritoryImportJobStatus;
  stage: TerritoryImportStage;
  draft: TerritoryDraftInput;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TerritorySaveResult =
  | { kind: 'saved'; workspace: TerritoryWorkspace }
  | { kind: 'importing'; job: TerritoryImportJob }
  | { kind: 'conflict'; error: string };

export type TerritoryImportSnapshot = {
  job: TerritoryImportJob | null;
  workspace: TerritoryWorkspace | null;
};

type JobRow = {
  id: string;
  status: TerritoryImportJobStatus;
  stage: TerritoryImportStage;
  draft_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  heartbeat_at: string | null;
};

type ScopedJob = TerritoryImportJob & { heartbeatAt: string | null };

type ImportRunner = (
  center: TerritoryDraftInput['center'],
  radiusMiles: number,
  onStage?: (stage: OvertureImportStage) => void,
) => Promise<ImportedTerritoryInput>;

type LifecycleOptions = {
  filename?: string;
  runImport?: ImportRunner;
  now?: () => number;
};

type TerritoryImportLifecycle = Readonly<{
  save: (draft: TerritoryDraftInput) => TerritorySaveResult;
  observe: () => TerritoryImportSnapshot;
}>;

const stageOrder: Record<TerritoryImportStage, number> = {
  queued: 0,
  downloading_streets: 1,
  downloading_buildings: 2,
  matching: 3,
  preparing: 4,
  saving: 5,
};

function fromRow(row: JobRow): ScopedJob {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    draft: parseTerritoryDraft(JSON.parse(row.draft_json)),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    heartbeatAt: row.heartbeat_at,
  };
}

function publicJob(job: ScopedJob): TerritoryImportJob {
  const { heartbeatAt: _heartbeatAt, ...result } = job;
  return result;
}

function fingerprint(draft: TerritoryDraftInput): string {
  const semanticDraft = {
    originAddress: draft.originAddress,
    center: draft.center,
    radiusMiles: draft.radiusMiles,
    boundaryShape: draft.boundaryShape,
    activatedSegmentIds: [...draft.activatedSegmentIds].sort(),
    excludedSegmentIds: [...draft.excludedSegmentIds].sort(),
  };
  return createHash('sha256').update(JSON.stringify(semanticDraft)).digest('hex');
}

function jobColumns(): string {
  return 'id, status, stage, draft_json, error, created_at, updated_at, heartbeat_at';
}

function timestampMilliseconds(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

export function createTerritoryImportLifecycle(
  options: LifecycleOptions = {},
): TerritoryImportLifecycle {
  const filename = options.filename;
  const runImport = options.runImport ?? runOvertureImport;
  const now = options.now ?? Date.now;
  const runningJobs = new Map<string, Promise<void>>();

  function readJob(id: string, scope: WorkspaceScope): ScopedJob | null {
    const database = openSqliteDatabase(filename);
    try {
      const row = database
        .prepare(
          `SELECT ${jobColumns()}
          FROM territory_import_jobs
          WHERE id = ? AND church_id = ? AND territory_id = ?`,
        )
        .get(id, scope.churchId, scope.territoryId) as JobRow | undefined;
      return row ? fromRow(row) : null;
    } finally {
      database.close();
    }
  }

  function readLatestJob(scope: WorkspaceScope): ScopedJob | null {
    const database = openSqliteDatabase(filename);
    try {
      const row = database
        .prepare(
          `SELECT ${jobColumns()}
          FROM territory_import_jobs
          WHERE church_id = ? AND territory_id = ?
          ORDER BY CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
            created_at DESC, rowid DESC
          LIMIT 1`,
        )
        .get(scope.churchId, scope.territoryId) as JobRow | undefined;
      return row ? fromRow(row) : null;
    } finally {
      database.close();
    }
  }

  function createOrReuseJob(
    draft: TerritoryDraftInput,
    scope: WorkspaceScope,
  ): ScopedJob | { conflict: string } {
    const storedDraft = parseTerritoryDraft(draft);
    const draftJson = JSON.stringify(storedDraft);
    const draftFingerprint = fingerprint(storedDraft);
    const database = openSqliteDatabase(filename);
    database.exec('BEGIN IMMEDIATE');
    try {
      const active = database
        .prepare(
          `SELECT ${jobColumns()}, draft_fingerprint
          FROM territory_import_jobs
          WHERE church_id = ? AND territory_id = ? AND status IN ('queued', 'running')`,
        )
        .get(scope.churchId, scope.territoryId) as
        | (JobRow & { draft_fingerprint: string })
        | undefined;
      if (active) {
        database.exec('COMMIT');
        return active.draft_fingerprint === draftFingerprint
          ? fromRow(active)
          : { conflict: ACTIVE_IMPORT_CONFLICT };
      }

      const id = randomUUID();
      database
        .prepare(
          `INSERT INTO territory_import_jobs
            (id, church_id, territory_id, draft_json, draft_fingerprint, status, stage)
          VALUES (?, ?, ?, ?, ?, 'queued', 'queued')`,
        )
        .run(id, scope.churchId, scope.territoryId, draftJson, draftFingerprint);
      database
        .prepare(`INSERT INTO territory_import_job_events (job_id, stage) VALUES (?, 'queued')`)
        .run(id);
      const row = database
        .prepare(`SELECT ${jobColumns()} FROM territory_import_jobs WHERE id = ?`)
        .get(id) as JobRow;
      database.exec('COMMIT');
      return fromRow(row);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }
  }

  function claimQueuedJob(id: string, scope: WorkspaceScope): ScopedJob | null {
    const database = openSqliteDatabase(filename);
    database.exec('BEGIN IMMEDIATE');
    try {
      const claimed = database
        .prepare(
          `UPDATE territory_import_jobs
          SET status = 'running', stage = 'downloading_streets',
            started_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'queued'`,
        )
        .run(id, scope.churchId, scope.territoryId);
      if (claimed.changes !== 1) {
        database.exec('COMMIT');
        return null;
      }
      database
        .prepare(
          `INSERT INTO territory_import_job_events (job_id, stage)
          VALUES (?, 'downloading_streets')`,
        )
        .run(id);
      const row = database
        .prepare(`SELECT ${jobColumns()} FROM territory_import_jobs WHERE id = ?`)
        .get(id) as JobRow;
      database.exec('COMMIT');
      return fromRow(row);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }
  }

  function recordHeartbeat(id: string, scope: WorkspaceScope): void {
    const database = openSqliteDatabase(filename);
    try {
      database
        .prepare(
          `UPDATE territory_import_jobs
          SET heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'`,
        )
        .run(id, scope.churchId, scope.territoryId);
    } finally {
      database.close();
    }
  }

  function recordStage(
    id: string,
    stage: Exclude<TerritoryImportStage, 'queued'>,
    scope: WorkspaceScope,
  ): void {
    const database = openSqliteDatabase(filename);
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = database
        .prepare(
          `SELECT stage FROM territory_import_jobs
          WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'`,
        )
        .get(id, scope.churchId, scope.territoryId) as { stage: TerritoryImportStage } | undefined;
      if (!current || stageOrder[stage] <= stageOrder[current.stage]) {
        database.exec('COMMIT');
        return;
      }
      const updated = database
        .prepare(
          `UPDATE territory_import_jobs
          SET stage = ?, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ?
            AND status = 'running' AND stage = ?`,
        )
        .run(stage, id, scope.churchId, scope.territoryId, current.stage);
      if (updated.changes === 1) {
        database
          .prepare(`INSERT INTO territory_import_job_events (job_id, stage) VALUES (?, ?)`)
          .run(id, stage);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }
  }

  function failActiveJob(id: string, scope: WorkspaceScope): void {
    const database = openSqliteDatabase(filename);
    try {
      database
        .prepare(
          `UPDATE territory_import_jobs
          SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ?
            AND status IN ('queued', 'running')`,
        )
        .run(SAFE_FAILURE, id, scope.churchId, scope.territoryId);
    } finally {
      database.close();
    }
  }

  function interruptIfUnchanged(job: ScopedJob, scope: WorkspaceScope): ScopedJob {
    const database = openSqliteDatabase(filename);
    try {
      database
        .prepare(
          `UPDATE territory_import_jobs
          SET status = 'interrupted', error = 'Street data preparation was interrupted.',
            completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'
            AND heartbeat_at IS ?`,
        )
        .run(job.id, scope.churchId, scope.territoryId, job.heartbeatAt);
    } finally {
      database.close();
    }
    return readJob(job.id, scope) ?? job;
  }

  async function execute(job: ScopedJob, scope: WorkspaceScope): Promise<void> {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      try {
        runInWorkspace(scope, () => recordHeartbeat(job.id, scope));
      } catch {
        // Progress reporting is best effort; the final transaction is authoritative.
      }
      heartbeat = setInterval(() => {
        try {
          runInWorkspace(scope, () => recordHeartbeat(job.id, scope));
        } catch {
          // Progress reporting is best effort; the final transaction is authoritative.
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      const imported = await runImport(job.draft.center, job.draft.radiusMiles, (stage) => {
        try {
          runInWorkspace(scope, () => recordStage(job.id, stage, scope));
        } catch {
          // Progress reporting is best effort; the final transaction is authoritative.
        }
      });
      try {
        runInWorkspace(scope, () => recordStage(job.id, 'saving', scope));
      } catch {
        // Saving progress is best effort; the atomic replacement records completion.
      }
      runInWorkspace(scope, () =>
        replaceTerritoryFromImport(job.draft, imported, { filename, importJobId: job.id }),
      );
    } catch {
      try {
        runInWorkspace(scope, () => failActiveJob(job.id, scope));
      } catch {
        // The saved territory remains authoritative if error reporting is unavailable.
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  function launchQueued(job: ScopedJob, scope: WorkspaceScope): ScopedJob {
    if (job.status !== 'queued') return job;
    const claimed = claimQueuedJob(job.id, scope);
    if (!claimed) return readJob(job.id, scope) ?? job;

    const execution = Promise.resolve().then(() => execute(claimed, scope));
    runningJobs.set(claimed.id, execution);
    void execution.then(
      () => runningJobs.delete(claimed.id),
      () => runningJobs.delete(claimed.id),
    );
    return claimed;
  }

  function save(draft: TerritoryDraftInput): TerritorySaveResult {
    const scope = requireWorkspaceScope();
    const normalizedDraft = parseTerritoryDraft(draft);
    const workspace = getTerritoryWorkspace(filename);
    if (!needsTerritoryImport(workspace.import, normalizedDraft)) {
      try {
        return {
          kind: 'saved',
          workspace: saveTerritoryDraft(normalizedDraft, { filename }),
        };
      } catch (error) {
        if (error instanceof TerritoryImportActiveError) {
          return { kind: 'conflict', error: ACTIVE_IMPORT_CONFLICT };
        }
        throw error;
      }
    }

    const created = createOrReuseJob(normalizedDraft, scope);
    if ('conflict' in created) return { kind: 'conflict', error: created.conflict };
    return { kind: 'importing', job: publicJob(launchQueued(created, scope)) };
  }

  function observe(): TerritoryImportSnapshot {
    const scope = requireWorkspaceScope();
    let job = readLatestJob(scope);
    if (!job) return { job: null, workspace: null };

    if (job.status === 'queued') {
      job = launchQueued(job, scope);
    } else if (
      job.status === 'running' &&
      !runningJobs.has(job.id) &&
      now() - timestampMilliseconds(job.heartbeatAt) > STALE_AFTER_MS
    ) {
      job = interruptIfUnchanged(job, scope);
    }

    return {
      job: publicJob(job),
      workspace: job.status === 'succeeded' ? getTerritoryWorkspace(filename) : null,
    };
  }

  return Object.freeze({ save, observe });
}

export const territoryImportLifecycle = createTerritoryImportLifecycle();
