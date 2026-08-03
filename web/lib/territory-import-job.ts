import { createHash, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { openWorkspaceDatabase, saveTerritoryDraft } from './database.ts';
import {
  type ImportedTerritoryInput,
  type OvertureImportStage,
  runOvertureImport,
} from './overture-import.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from './territory-draft.ts';
import { requireWorkspaceScope, runInWorkspace, type WorkspaceScope } from './workspace-scope.ts';

export type TerritoryImportStage =
  | 'queued'
  | 'downloading_streets'
  | 'downloading_buildings'
  | 'matching'
  | 'preparing'
  | 'saving';

export type TerritoryImportJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted';

export type TerritoryImportJob = {
  id: string;
  status: TerritoryImportJobStatus;
  stage: TerritoryImportStage;
  draft: TerritoryDraftInput;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  status: TerritoryImportJobStatus;
  stage: TerritoryImportStage;
  draft_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export class TerritoryImportConflictError extends Error {}

function fromRow(row: JobRow): TerritoryImportJob {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    draft: parseTerritoryDraft(JSON.parse(row.draft_json)),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobFingerprint(draftJson: string): string {
  return createHash('sha256').update(draftJson).digest('hex');
}

export function createOrReuseTerritoryImportJob(
  draft: TerritoryDraftInput,
  filename?: string,
): TerritoryImportJob {
  const scope = requireWorkspaceScope();
  const draftJson = JSON.stringify(draft);
  const fingerprint = jobFingerprint(draftJson);
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const active = database
      .prepare(
        `SELECT id, status, stage, draft_json, error, created_at, updated_at,
          draft_fingerprint
        FROM territory_import_jobs
        WHERE church_id = ? AND territory_id = ? AND status IN ('queued', 'running')`,
      )
      .get(scope.churchId, scope.territoryId) as
      | (JobRow & { draft_fingerprint: string })
      | undefined;
    if (active) {
      if (active.draft_fingerprint !== fingerprint) {
        throw new TerritoryImportConflictError('Another territory import is already running');
      }
      database.exec('COMMIT');
      return fromRow(active);
    }

    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO territory_import_jobs
          (id, church_id, territory_id, draft_json, draft_fingerprint, status, stage)
        VALUES (?, ?, ?, ?, ?, 'queued', 'queued')`,
      )
      .run(id, scope.churchId, scope.territoryId, draftJson, fingerprint);
    database
      .prepare(`INSERT INTO territory_import_job_events (job_id, stage) VALUES (?, ?)`)
      .run(id, 'queued');
    const row = database
      .prepare(
        `SELECT id, status, stage, draft_json, error, created_at, updated_at
        FROM territory_import_jobs WHERE id = ?`,
      )
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

export function getTerritoryImportJob(id: string, filename?: string): TerritoryImportJob | null {
  const scope = requireWorkspaceScope();
  const database = openWorkspaceDatabase(filename);
  try {
    const row = database
      .prepare(
        `SELECT id, status, stage, draft_json, error, created_at, updated_at
        FROM territory_import_jobs
        WHERE id = ? AND church_id = ? AND territory_id = ?`,
      )
      .get(id, scope.churchId, scope.territoryId) as JobRow | undefined;
    return row ? fromRow(row) : null;
  } finally {
    database.close();
  }
}

export function getLatestTerritoryImportJob(filename?: string): TerritoryImportJob | null {
  const scope = requireWorkspaceScope();
  const database = openWorkspaceDatabase(filename);
  try {
    const row = database
      .prepare(
        `SELECT id, status, stage, draft_json, error, created_at, updated_at
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

function transitionJob(
  id: string,
  sql: string,
  parameters: SQLInputValue[],
  filename?: string,
  recordedStage?: TerritoryImportStage,
): TerritoryImportJob {
  const scope = requireWorkspaceScope();
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database.prepare(sql).run(...parameters, id, scope.churchId, scope.territoryId);
    if (result.changes !== 1) throw new Error('Territory import job is not available');
    if (recordedStage) {
      database
        .prepare(`INSERT INTO territory_import_job_events (job_id, stage) VALUES (?, ?)`)
        .run(id, recordedStage);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  const job = getTerritoryImportJob(id, filename);
  if (!job) throw new Error('Territory import job was not found');
  return job;
}
export function startTerritoryImportJob(id: string, filename?: string): TerritoryImportJob {
  return transitionJob(
    id,
    `UPDATE territory_import_jobs
    SET status = 'running', stage = 'downloading_streets', started_at = CURRENT_TIMESTAMP,
      heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'queued'`,
    [],
    filename,
    'downloading_streets',
  );
}

export function updateTerritoryImportStage(
  id: string,
  stage: Exclude<TerritoryImportStage, 'queued'>,
  filename?: string,
): TerritoryImportJob {
  return transitionJob(
    id,
    `UPDATE territory_import_jobs
    SET stage = ?, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'`,
    [stage],
    filename,
    stage,
  );
}

export function touchTerritoryImportJob(id: string, filename?: string): void {
  const scope = requireWorkspaceScope();
  const database = openWorkspaceDatabase(filename);
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

export function failTerritoryImportJob(
  id: string,
  error: string,
  filename?: string,
): TerritoryImportJob {
  return transitionJob(
    id,
    `UPDATE territory_import_jobs
    SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = ? AND church_id = ? AND territory_id = ? AND status IN ('queued', 'running')`,
    [error.slice(0, 300)],
    filename,
  );
}

export function interruptTerritoryImportJob(id: string, filename?: string): TerritoryImportJob {
  return transitionJob(
    id,
    `UPDATE territory_import_jobs
    SET status = 'interrupted', error = 'Street data preparation was interrupted.',
      completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'`,
    [],
    filename,
  );
}

export function finishTerritoryImportJob(
  id: string,
  imported: ImportedTerritoryInput,
  filename?: string,
): TerritoryImportJob {
  const job = getTerritoryImportJob(id, filename);
  if (job?.status !== 'running') throw new Error('Territory import job is not running');
  updateTerritoryImportStage(id, 'saving', filename);
  saveTerritoryDraft(job.draft, { filename, imported, importJobId: id });
  const completed = getTerritoryImportJob(id, filename);
  if (!completed) throw new Error('Territory import job was not found');
  return completed;
}

const runningJobs = new Map<string, Promise<void>>();

export function ensureTerritoryImportJobRunning(
  job: TerritoryImportJob,
  scope: WorkspaceScope,
  filename?: string,
): void {
  if (
    runningJobs.has(job.id) ||
    job.status === 'succeeded' ||
    job.status === 'failed' ||
    job.status === 'interrupted'
  ) {
    return;
  }
  if (job.status === 'running') {
    const updatedAt = Date.parse(`${job.updatedAt.replace(' ', 'T')}Z`);
    if (Date.now() - updatedAt <= 60_000) return;
    runInWorkspace(scope, () => interruptTerritoryImportJob(job.id, filename));
    return;
  }

  const execution = runInWorkspace(scope, async () => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      startTerritoryImportJob(job.id, filename);
      heartbeat = setInterval(() => {
        try {
          runInWorkspace(scope, () => touchTerritoryImportJob(job.id, filename));
        } catch {
          // Progress reporting is best effort; the final save remains authoritative.
        }
      }, 10_000);
      const imported = await runOvertureImport(
        job.draft.center,
        job.draft.radiusMiles,
        (stage: OvertureImportStage) => {
          try {
            runInWorkspace(scope, () => updateTerritoryImportStage(job.id, stage, filename));
          } catch {
            // Progress reporting is best effort; the final save remains authoritative.
          }
        },
      );
      runInWorkspace(scope, () => finishTerritoryImportJob(job.id, imported, filename));
    } catch {
      try {
        const current = runInWorkspace(scope, () => getTerritoryImportJob(job.id, filename));
        if (current?.status === 'queued' || current?.status === 'running') {
          runInWorkspace(scope, () =>
            failTerritoryImportJob(
              job.id,
              'Street data preparation failed. Your previous saved territory is still active.',
              filename,
            ),
          );
        }
      } catch {
        // The saved territory is still authoritative even if job error reporting is unavailable.
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      runningJobs.delete(job.id);
    }
  });
  runningJobs.set(job.id, execution);
}
