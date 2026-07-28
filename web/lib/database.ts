import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ImportedTerritoryInput } from './overture-import.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  type LineString,
  lineInsideTerritoryBoundary,
  lineIntersectsPolygon,
  type Polygon,
  type Position,
  territoryBoundary,
} from './territory-geometry.ts';
import type { TerritoryImportMetadata } from './territory-import.ts';

const PILOT_CHURCH_ID = 'church-temecula-pilot';
const PILOT_TERRITORY_ID = 'territory-temecula-pilot';

type SummaryRow = {
  packet_count: number;
};

type TerritoryRow = {
  id: string;
  church_name: string;
  name: string;
  origin_address: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  boundary_shape: 'circle' | 'square';
  import_kind: 'proof' | 'overture';
  import_release: string | null;
  import_center_latitude: number | null;
  import_center_longitude: number | null;
  import_radius_meters: number | null;
  import_completed_at: string | null;
  import_total_addresses: number | null;
  import_assigned_addresses: number | null;
  import_inferred_roads: number | null;
  import_unmatched_addresses: number | null;
  import_unresolved_clusters: number | null;
  import_normalizer_version: number | null;
  import_generation: number;
};

type SegmentRow = {
  id: string;
  source_segment_id: string | null;
  road_group_id: string;
  road_class: string;
  street_name: string;
  geometry_geojson: string;
  estimated_homes: number;
  activation_kind: 'automatic' | 'hidden' | 'manual';
  manually_excluded: number;
};

type ExclusionRow = {
  id: string;
  name: string;
  enabled: number;
  geometry_geojson: string;
};

export type FoundationSummary = {
  churchName: string;
  territoryName: string;
  segmentCount: number;
  estimatedHomes: number;
  packetCount: number;
};

export type ExclusionArea = {
  id: string;
  name: string;
  enabled: boolean;
  geometry: Polygon;
};

export type TerritorySegment = {
  id: string;
  sourceSegmentId: string;
  roadGroupId: string;
  roadClass: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  activationKind: 'automatic' | 'hidden' | 'manual';
  active: boolean;
  withinBoundary: boolean;
  manuallyExcluded: boolean;
  eligible: boolean;
  excludedReason: 'hidden' | 'boundary' | 'exclusion' | 'segment' | null;
};

export type TerritoryWorkspace = {
  id: string;
  churchName: string;
  name: string;
  originAddress: string;
  center: Position;
  radiusMiles: number;
  boundaryShape: 'circle' | 'square';
  import: TerritoryImportMetadata;
  exclusions: ExclusionArea[];
  segments: TerritorySegment[];
  totals: {
    allSegments: number;
    eligibleSegments: number;
    allHomes: number;
    eligibleHomes: number;
  };
};

function openWorkspaceDatabase(filename?: string): DatabaseSync {
  const database = new DatabaseSync(filename ?? path.join(process.cwd(), 'data', 'streetlight.db'));
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

function parseGeometry<T extends LineString | Polygon>(json: string): T {
  return JSON.parse(json) as T;
}

export function getFoundationSummary(filename?: string): FoundationSummary {
  const workspace = getTerritoryWorkspace(filename);
  const database = openWorkspaceDatabase(filename);
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS packet_count
        FROM packets
        WHERE church_id = ?`,
      )
      .get(PILOT_CHURCH_ID) as SummaryRow;
    return {
      churchName: workspace.churchName,
      territoryName: workspace.name,
      segmentCount: workspace.totals.eligibleSegments,
      estimatedHomes: workspace.totals.eligibleHomes,
      packetCount: row.packet_count,
    };
  } finally {
    database.close();
  }
}

export function getTerritoryWorkspace(filename?: string): TerritoryWorkspace {
  const database = openWorkspaceDatabase(filename);
  try {
    const territory = database
      .prepare(
        `SELECT t.id, c.name AS church_name, t.name, t.origin_address,
          t.center_latitude, t.center_longitude, t.radius_meters, t.boundary_shape,
          t.import_kind, t.import_release, t.import_center_latitude,
          t.import_center_longitude, t.import_radius_meters, t.import_completed_at,
          t.import_total_addresses, t.import_assigned_addresses, t.import_inferred_roads,
          t.import_unmatched_addresses, t.import_unresolved_clusters,
          t.import_normalizer_version,
          t.import_generation
        FROM territories t
        JOIN churches c ON c.id = t.church_id
        WHERE t.id = ? AND t.church_id = ?`,
      )
      .get(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as TerritoryRow | undefined;
    if (!territory) {
      throw new Error('No local workspace found. Run pnpm db:seed.');
    }

    const exclusions = (
      database
        .prepare(
          `SELECT id, name, enabled, geometry_geojson
          FROM ignore_zones
          WHERE territory_id = ? AND church_id = ?
          ORDER BY created_at, id`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as ExclusionRow[]
    ).map(
      (row): ExclusionArea => ({
        id: row.id,
        name: row.name,
        enabled: row.enabled === 1,
        geometry: parseGeometry<Polygon>(row.geometry_geojson),
      }),
    );
    const center: Position = [territory.center_longitude, territory.center_latitude];
    const radiusMiles = territory.radius_meters / 1609.344;
    const boundaryShape = territory.boundary_shape;
    const imported: TerritoryImportMetadata =
      territory.import_kind === 'proof'
        ? {
            kind: 'proof',
            release: null,
            center: null,
            radiusMiles: null,
            completedAt: null,
            normalizerVersion: null,
            quality: null,
          }
        : {
            kind: 'overture',
            release: territory.import_release,
            center:
              territory.import_center_longitude === null ||
              territory.import_center_latitude === null
                ? null
                : [territory.import_center_longitude, territory.import_center_latitude],
            radiusMiles:
              territory.import_radius_meters === null
                ? null
                : territory.import_radius_meters / 1609.344,
            completedAt: territory.import_completed_at,
            normalizerVersion: territory.import_normalizer_version,
            quality:
              territory.import_total_addresses === null ||
              territory.import_assigned_addresses === null ||
              territory.import_inferred_roads === null ||
              territory.import_unmatched_addresses === null ||
              territory.import_unresolved_clusters === null
                ? null
                : {
                    totalAddresses: territory.import_total_addresses,
                    assignedAddresses: territory.import_assigned_addresses,
                    inferredRoads: territory.import_inferred_roads,
                    unmatchedAddresses: territory.import_unmatched_addresses,
                    unresolvedClusters: territory.import_unresolved_clusters,
                  },
          };
    const segments = (
      database
        .prepare(
          `SELECT import_segment_id AS id, source_segment_id, road_group_id, road_class,
            street_name, geometry_geojson, estimated_homes, activation_kind, manually_excluded
          FROM street_segments
          WHERE territory_id = ? AND church_id = ? AND is_current = 1
          ORDER BY street_name, import_segment_id`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as SegmentRow[]
    ).map((row): TerritorySegment => {
      const geometry = parseGeometry<LineString>(row.geometry_geojson);
      const withinBoundary = lineInsideTerritoryBoundary(
        geometry,
        center,
        radiusMiles,
        boundaryShape,
      );
      const excluded = exclusions.some(
        (area) => area.enabled && lineIntersectsPolygon(geometry, area.geometry),
      );
      const active = row.activation_kind !== 'hidden';
      const manuallyExcluded = row.manually_excluded === 1;
      return {
        id: row.id,
        sourceSegmentId: row.source_segment_id ?? row.id,
        roadGroupId: row.road_group_id || row.id,
        roadClass: row.road_class,
        streetName: row.street_name,
        geometry,
        estimatedHomes: row.estimated_homes,
        activationKind: row.activation_kind,
        active,
        withinBoundary,
        manuallyExcluded,
        eligible: active && withinBoundary && !excluded && !manuallyExcluded,
        excludedReason: !withinBoundary
          ? 'boundary'
          : !active
            ? 'hidden'
            : excluded
              ? 'exclusion'
              : manuallyExcluded
                ? 'segment'
                : null,
      };
    });

    return {
      id: territory.id,
      churchName: territory.church_name,
      name: territory.name,
      originAddress: territory.origin_address,
      center,
      radiusMiles,
      boundaryShape,
      import: imported,
      exclusions,
      segments,
      totals: {
        allSegments: segments.filter((segment) => segment.active && segment.withinBoundary).length,
        eligibleSegments: segments.filter((segment) => segment.eligible).length,
        allHomes: segments
          .filter((segment) => segment.active && segment.withinBoundary)
          .reduce((total, segment) => total + segment.estimatedHomes, 0),
        eligibleHomes: segments
          .filter((segment) => segment.eligible)
          .reduce((total, segment) => total + segment.estimatedHomes, 0),
      },
    };
  } finally {
    database.close();
  }
}

type SaveTerritoryOptions = {
  filename?: string;
  imported?: ImportedTerritoryInput;
};

export function saveTerritoryDraft(
  draft: TerritoryDraftInput,
  options: SaveTerritoryOptions = {},
): void {
  const database = openWorkspaceDatabase(options.filename);
  const activatedRoadGroupIds = new Set(draft.activatedRoadGroupIds);
  const excludedSegmentIds = new Set(draft.excludedSegmentIds ?? []);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database
      .prepare(
        `UPDATE territories
        SET origin_address = ?, center_longitude = ?, center_latitude = ?,
          radius_meters = ?, boundary_shape = ?, boundary_geojson = ?
        WHERE id = ? AND church_id = ?`,
      )
      .run(
        draft.originAddress,
        draft.center[0],
        draft.center[1],
        draft.radiusMiles * 1609.344,
        draft.boundaryShape,
        JSON.stringify(territoryBoundary(draft.center, draft.radiusMiles, draft.boundaryShape)),
        PILOT_TERRITORY_ID,
        PILOT_CHURCH_ID,
      );
    if (result.changes !== 1) {
      throw new Error('Territory not found');
    }

    database
      .prepare('DELETE FROM ignore_zones WHERE territory_id = ? AND church_id = ?')
      .run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID);
    const insert = database.prepare(
      `INSERT INTO ignore_zones
        (id, church_id, territory_id, name, enabled, geometry_geojson)
      VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const exclusion of draft.exclusions) {
      insert.run(
        exclusion.id,
        PILOT_CHURCH_ID,
        PILOT_TERRITORY_ID,
        exclusion.name,
        exclusion.enabled ? 1 : 0,
        JSON.stringify(exclusion.geometry),
      );
    }

    if (options.imported) {
      const excludedGeometryById = new Map(
        (
          database
            .prepare(
              `SELECT import_segment_id, geometry_geojson
              FROM street_segments
              WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
            )
            .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Array<{
            import_segment_id: string;
            geometry_geojson: string;
          }>
        )
          .filter((row) => excludedSegmentIds.has(row.import_segment_id))
          .map((row) => [row.import_segment_id, row.geometry_geojson]),
      );
      excludedSegmentIds.clear();
      const manualRows = database
        .prepare(
          `SELECT import_segment_id, source_segment_id, road_group_id, road_class, street_name,
            geometry_geojson, estimated_homes
          FROM street_segments
          WHERE territory_id = ? AND church_id = ? AND is_current = 1
            AND activation_kind = 'manual'`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Array<
        SegmentRow & { import_segment_id: string }
      >;
      const manuallyActivatedSources = new Set(
        manualRows
          .map((row) => row.source_segment_id)
          .filter((sourceId): sourceId is string => sourceId !== null),
      );
      const importedSourceIds = new Set(
        options.imported.segments.map((segment) => segment.sourceSegmentId),
      );
      for (const segment of options.imported.segments) {
        if (manuallyActivatedSources.has(segment.sourceSegmentId)) {
          activatedRoadGroupIds.add(segment.roadGroupId);
        }
      }
      const generation =
        (
          database
            .prepare(
              `SELECT import_generation
              FROM territories
              WHERE id = ? AND church_id = ?`,
            )
            .get(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Pick<TerritoryRow, 'import_generation'>
        ).import_generation + 1;
      database
        .prepare(
          `UPDATE street_segments
          SET is_current = 0
          WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
        )
        .run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID);
      const insertSegment = database.prepare(
        `INSERT INTO street_segments
          (id, church_id, territory_id, import_segment_id, source_segment_id, road_group_id,
            road_class, street_name, geometry_geojson, estimated_homes, activation_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const segment of options.imported.segments) {
        const geometry = JSON.stringify(segment.geometry);
        insertSegment.run(
          `${segment.id}@${generation}`,
          PILOT_CHURCH_ID,
          PILOT_TERRITORY_ID,
          segment.id,
          segment.sourceSegmentId,
          segment.roadGroupId,
          segment.roadClass,
          segment.streetName,
          geometry,
          segment.estimatedHomes,
          segment.activationKind,
        );
        if (excludedGeometryById.get(segment.id) === geometry) {
          excludedSegmentIds.add(segment.id);
        }
      }
      for (const segment of manualRows) {
        if (segment.source_segment_id && importedSourceIds.has(segment.source_segment_id)) {
          continue;
        }
        insertSegment.run(
          `${segment.import_segment_id}@${generation}`,
          PILOT_CHURCH_ID,
          PILOT_TERRITORY_ID,
          segment.import_segment_id,
          segment.source_segment_id,
          segment.road_group_id,
          segment.road_class,
          segment.street_name,
          segment.geometry_geojson,
          segment.estimated_homes,
          'manual',
        );
        activatedRoadGroupIds.add(segment.road_group_id);
        if (excludedGeometryById.get(segment.import_segment_id) === segment.geometry_geojson) {
          excludedSegmentIds.add(segment.import_segment_id);
        }
      }
      database
        .prepare(
          `UPDATE territories
          SET import_kind = 'overture', import_release = ?,
            import_center_latitude = ?, import_center_longitude = ?,
            import_radius_meters = ?, import_completed_at = ?, import_total_addresses = ?,
            import_assigned_addresses = ?, import_inferred_roads = ?, import_unmatched_addresses = ?,
            import_unresolved_clusters = ?, import_normalizer_version = ?, import_generation = ?
          WHERE id = ? AND church_id = ?`,
        )
        .run(
          options.imported.release,
          options.imported.center[1],
          options.imported.center[0],
          options.imported.radiusMiles * 1609.344,
          options.imported.completedAt,
          options.imported.quality.totalAddresses,
          options.imported.quality.assignedAddresses,
          options.imported.quality.inferredRoads,
          options.imported.quality.unmatchedAddresses,
          options.imported.quality.unresolvedClusters,
          options.imported.normalizerVersion,
          generation,
          PILOT_TERRITORY_ID,
          PILOT_CHURCH_ID,
        );
    }
    const activate = database.prepare(
      `UPDATE street_segments
      SET activation_kind = 'manual'
      WHERE territory_id = ? AND church_id = ? AND is_current = 1 AND road_group_id = ?`,
    );
    for (const roadGroupId of activatedRoadGroupIds) {
      activate.run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID, roadGroupId);
    }
    database
      .prepare(
        `UPDATE street_segments
        SET manually_excluded = 0
        WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
      )
      .run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID);
    const excludeSegment = database.prepare(
      `UPDATE street_segments
      SET manually_excluded = 1
      WHERE territory_id = ? AND church_id = ? AND is_current = 1
        AND import_segment_id = ?`,
    );
    for (const segmentId of excludedSegmentIds) {
      excludeSegment.run(PILOT_TERRITORY_ID, PILOT_CHURCH_ID, segmentId);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
