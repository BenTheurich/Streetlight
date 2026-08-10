import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { TEMECULA_TEST_WORKSPACE, withTemeculaWorkspace } from '../test/workspace-fixtures.ts';
import { getTerritoryWorkspace } from './database.ts';
import { territoryDraftFromWorkspace } from './territory-client.ts';
import {
  createOrReuseTerritoryImportJob,
  ensureTerritoryImportJobRunning,
  failTerritoryImportJob,
  finishTerritoryImportJob,
  getTerritoryImportJob,
  startTerritoryImportJob,
  updateTerritoryImportStage,
} from './territory-import-job.ts';

test('a separate route instance does not interrupt a fresh running import', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-import-job-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();

  try {
    withTemeculaWorkspace(() => {
      const before = getTerritoryWorkspace(filename);
      const draft = {
        ...territoryDraftFromWorkspace(before),
        radiusMiles: Math.min(before.radiusMiles + 0.25, 5),
      };
      const queued = createOrReuseTerritoryImportJob(draft, filename);
      const running = startTerritoryImportJob(queued.id, filename);

      ensureTerritoryImportJobRunning(running, TEMECULA_TEST_WORKSPACE, filename);

      assert.equal(getTerritoryImportJob(running.id, filename)?.status, 'running');

      const staleDatabase = openDatabase(filename);
      staleDatabase
        .prepare(`UPDATE territory_import_jobs SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`)
        .run(running.id);
      staleDatabase.close();
      const stale = getTerritoryImportJob(running.id, filename);
      assert.ok(stale);

      ensureTerritoryImportJobRunning(stale, TEMECULA_TEST_WORKSPACE, filename);

      assert.equal(getTerritoryImportJob(running.id, filename)?.status, 'interrupted');
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('territory import jobs are deduplicated, staged, and swap territory only on success', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-import-job-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();

  try {
    withTemeculaWorkspace(() => {
      const before = getTerritoryWorkspace(filename);
      const draft = {
        ...territoryDraftFromWorkspace(before),
        radiusMiles: Math.min(before.radiusMiles + 0.25, 5),
      };
      const first = createOrReuseTerritoryImportJob(draft, filename);
      const replay = createOrReuseTerritoryImportJob(structuredClone(draft), filename);

      assert.equal(replay.id, first.id);
      assert.deepEqual(getTerritoryWorkspace(filename), before);
      assert.equal(startTerritoryImportJob(first.id, filename).status, 'running');
      assert.equal(updateTerritoryImportStage(first.id, 'matching', filename).stage, 'matching');
      assert.equal(failTerritoryImportJob(first.id, 'Import failed', filename).status, 'failed');
      assert.deepEqual(getTerritoryWorkspace(filename), before);

      const retry = createOrReuseTerritoryImportJob(draft, filename);
      assert.notEqual(retry.id, first.id);
      startTerritoryImportJob(retry.id, filename);
      finishTerritoryImportJob(
        retry.id,
        {
          release: '2026-06-17.0',
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
              id: 'imported:test:0',
              sourceSegmentId: 'test',
              roadGroupId: 'road-group:test',
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
        },
        filename,
      );

      assert.equal(getTerritoryImportJob(retry.id, filename)?.status, 'succeeded');
      const eventDatabase = openDatabase(filename);
      const stages = eventDatabase
        .prepare('SELECT stage FROM territory_import_job_events WHERE job_id = ? ORDER BY id')
        .all(retry.id)
        .map((row) => row.stage);
      eventDatabase.close();
      assert.deepEqual(stages, ['queued', 'downloading_streets', 'saving']);
      assert.equal(getTerritoryWorkspace(filename).radiusMiles, draft.radiusMiles);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
