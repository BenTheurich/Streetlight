import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { seedDatabase } from '../../../db/seed.mjs';
import { getTerritoryWorkspace, saveTerritoryDraft } from '../../../lib/database.ts';
import type { ImportedTerritoryInput } from '../../../lib/overture-import.ts';
import { withTemeculaWorkspace } from '../../../test/workspace-fixtures.ts';
import { updateTerritory } from './route.ts';

function imported(
  center: [number, number],
  radiusMiles: number,
  id: string,
): ImportedTerritoryInput {
  return {
    release: '2026-06-17.0',
    center,
    radiusMiles,
    completedAt: `2026-08-04T12:00:0${id.length}.000Z`,
    normalizerVersion: 10,
    buildingMode: 'overture_only',
    mapBuildings: [],
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
    apartmentComplexes: [],
    segments: [
      {
        id,
        sourceSegmentId: `source-${id}`,
        roadGroupId: `group-${id}`,
        roadClass: 'residential',
        streetName: `${id} Road`,
        geometry: { type: 'LineString', coordinates: [center, [center[0] + 0.0001, center[1]]] },
        estimatedHomes: 0,
        activationKind: 'automatic',
        addresses: [],
      },
    ],
  };
}

function request(workspace: ReturnType<typeof getTerritoryWorkspace>, radiusMiles: number) {
  return new Request('http://streetlight.local/api/territory', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      originAddress: workspace.originAddress,
      center: workspace.center,
      radiusMiles,
      boundaryShape: workspace.boundaryShape,
      activatedRoadGroupIds: [],
      excludedSegmentIds: [],
      exclusions: workspace.exclusions,
    }),
  });
}

function withDatabase(run: (filename: string) => Promise<void>) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-territory-route-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  return withTemeculaWorkspace(async () => {
    try {
      await run(filename);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('expansion imports only new strips and atomically merges them with the current generation', () =>
  withDatabase(async (filename) => {
    const initial = getTerritoryWorkspace(filename);
    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: 1,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: initial.exclusions,
      },
      { filename, imported: imported(initial.center, 1, 'existing') },
    );
    const saved = getTerritoryWorkspace(filename);
    const bounds = [];
    const response = await updateTerritory(request(saved, 2), {
      filename,
      runImport: async (center, radiusMiles, box) => {
        bounds.push(box);
        return imported(center, radiusMiles, `added-${bounds.length}`);
      },
    });

    assert.equal(response.status, 200);
    assert.equal(bounds.length, 4);
    const expanded = getTerritoryWorkspace(filename);
    assert.equal(expanded.import.radiusMiles, 2);
    assert.deepEqual(
      new Set(expanded.segments.map(({ id }) => id)),
      new Set(['existing', 'added-1', 'added-2', 'added-3', 'added-4']),
    );
  }));

test('an incremental strip failure preserves the previous saved region and generation', () =>
  withDatabase(async (filename) => {
    const initial = getTerritoryWorkspace(filename);
    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: 1,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: initial.exclusions,
      },
      { filename, imported: imported(initial.center, 1, 'existing') },
    );
    const before = getTerritoryWorkspace(filename);
    let calls = 0;
    const response = await updateTerritory(request(before, 2), {
      filename,
      runImport: async (center, radiusMiles) => {
        calls += 1;
        if (calls === 2) throw new Error('download failed');
        return imported(center, radiusMiles, `unused-${calls}`);
      },
    });

    assert.equal(response.status, 500);
    assert.deepEqual(getTerritoryWorkspace(filename), before);
  }));

test('an unsafe incremental merge fails without replacing the previous generation', () =>
  withDatabase(async (filename) => {
    const initial = getTerritoryWorkspace(filename);
    const current = imported(initial.center, 1, 'existing');
    current.segments[0].addresses = Array.from({ length: 100 }, (_, index) => ({
      number: String(index + 1),
      street: 'existing Road',
      locality: 'Temecula',
      postcode: '92591',
      position: [initial.center[0] + index * 0.000001, initial.center[1]],
    }));
    current.segments[0].estimatedHomes = 100;
    saveTerritoryDraft(
      {
        originAddress: initial.originAddress,
        center: initial.center,
        radiusMiles: 1,
        boundaryShape: initial.boundaryShape,
        activatedRoadGroupIds: [],
        excludedSegmentIds: [],
        exclusions: initial.exclusions,
      },
      { filename, imported: current },
    );
    const before = getTerritoryWorkspace(filename);
    let fullImportAttempted = false;
    const response = await updateTerritory(request(before, 2), {
      filename,
      runImport: async (center, radiusMiles, bounds) => {
        if (!bounds) fullImportAttempted = true;
        const addition = imported(center, radiusMiles, 'existing');
        addition.segments[0].addresses = [
          {
            number: 'new',
            street: 'existing Road',
            locality: 'Temecula',
            postcode: '92591',
            position: [center[0], center[1]],
          },
        ];
        addition.segments[0].estimatedHomes = 1;
        return addition;
      },
    });

    assert.equal(response.status, 500);
    assert.equal(fullImportAttempted, false);
    assert.deepEqual(getTerritoryWorkspace(filename), before);
  }));
