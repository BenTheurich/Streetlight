import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import type {
  ImportedApartmentSite,
  ImportedTerritoryInput,
  ImportedTerritorySegment,
} from '../lib/overture-import.ts';
import { requireWorkspaceScope } from '../lib/workspace-scope.ts';
import { withTemeculaWorkspace } from './workspace-fixtures.ts';

export function withSeededTemeculaDatabase(run: (filename: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-persistence-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database);
  } finally {
    database.close();
  }

  try {
    withTemeculaWorkspace(() => run(filename));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function importedSegmentFixture(
  id: string,
  streetName: string,
  roadClass: string,
  estimatedHomes: number,
  activationKind: ImportedTerritorySegment['activationKind'] = 'automatic',
  roadGroupId = `road-group:${id}`,
): ImportedTerritorySegment {
  return {
    id,
    sourceSegmentId: `source-${id}`,
    roadGroupId,
    roadClass,
    streetName,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-117.1169, 33.5429],
        [-117.1168, 33.543],
      ],
    },
    estimatedHomes,
    addresses: [],
    activationKind,
  };
}

export function importedTerritoryFixture(
  segments: ImportedTerritorySegment[],
): ImportedTerritoryInput {
  return {
    release: '2026-08-19.0',
    center: [-117.116885, 33.54293],
    radiusMiles: 10,
    completedAt: '2026-07-27T12:00:00.000Z',
    normalizerVersion: 12,
    buildingMode: 'overture_fema',
    mapBuildings: [
      {
        source: 'overture',
        sourceId: 'building-one',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-117.117, 33.5429],
              [-117.1169, 33.5429],
              [-117.1169, 33.543],
              [-117.117, 33.5429],
            ],
          ],
        },
        fema: null,
      },
    ],
    quality: {
      totalAddresses: 12,
      assignedAddresses: 10,
      spatiallyAssignedAddresses: 3,
      inferredRoads: 1,
      unmatchedAddresses: 2,
      unresolvedClusters: 0,
      totalResidentialBuildings: 9,
      fallbackBuildings: 2,
      unmatchedResidentialBuildings: 1,
      populatedUnnamedRoads: 0,
      buildingAddressDisagreements: 1,
      warnings: ['Address matching is below the 95% reliability target (83.3% matched).'],
    },
    segments,
    apartmentSites: [],
  };
}

export function importedApartmentFixture(
  id: string,
  address: string | null = '10 Sample Road, Temecula CA 92591',
): ImportedApartmentSite {
  return {
    id,
    sourceId: `source-${id}`,
    name: null,
    address,
    position: [-117.11685, 33.54295],
    boundary: null,
    groupingKind: 'ungrouped',
    members: [
      {
        id,
        sourceId: `source-${id}`,
        address,
        position: [-117.11685, 33.54295],
        geometry: null,
        apartmentBuilding: true,
        distinctUnits: 12,
      },
    ],
  };
}

export function insertCoverageCompletionFixture(
  segmentId: string,
  coveredOn: string,
  filename: string,
): string {
  const scope = requireWorkspaceScope();
  const database = openDatabase(filename);
  try {
    const segment = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get(scope.churchId, scope.territoryId, segmentId) as { id: string } | undefined;
    if (!segment) throw new Error('Street segment not found');
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
        VALUES (?, ?, ?, ?, 'completed')`,
      )
      .run(id, scope.churchId, segment.id, coveredOn);
    return id;
  } finally {
    database.close();
  }
}
