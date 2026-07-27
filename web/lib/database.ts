import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  circleBoundary,
  type LineString,
  lineInsideCircle,
  lineIntersectsPolygon,
  type Polygon,
  type Position,
} from './territory-geometry.ts';

const PILOT_CHURCH_ID = 'church-temecula-pilot';
const PILOT_TERRITORY_ID = 'territory-temecula-pilot';

type SummaryRow = {
  church_name: string;
  territory_name: string;
  segment_count: number;
  estimated_homes: number;
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
};

type SegmentRow = {
  id: string;
  source_segment_id: string | null;
  street_name: string;
  geometry_geojson: string;
  estimated_homes: number;
};

type ExclusionRow = {
  id: string;
  name: string;
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
  geometry: Polygon;
};

export type TerritorySegment = {
  id: string;
  sourceSegmentId: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  eligible: boolean;
  excludedReason: 'radius' | 'exclusion' | null;
};

export type TerritoryWorkspace = {
  id: string;
  churchName: string;
  name: string;
  originAddress: string;
  center: Position;
  radiusMiles: number;
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

export function getFoundationSummary(): FoundationSummary {
  const database = openWorkspaceDatabase();
  try {
    const row = database
      .prepare(
        `SELECT
          c.name AS church_name,
          t.name AS territory_name,
          (SELECT COUNT(*) FROM street_segments s WHERE s.church_id = c.id) AS segment_count,
          (SELECT COALESCE(SUM(s.estimated_homes), 0) FROM street_segments s WHERE s.church_id = c.id) AS estimated_homes,
          (SELECT COUNT(*) FROM packets p WHERE p.church_id = c.id) AS packet_count
        FROM churches c
        JOIN territories t ON t.church_id = c.id
        ORDER BY c.created_at
        LIMIT 1`,
      )
      .get() as SummaryRow | undefined;

    if (!row) {
      throw new Error('No local workspace found. Run pnpm db:seed.');
    }
    return {
      churchName: row.church_name,
      territoryName: row.territory_name,
      segmentCount: row.segment_count,
      estimatedHomes: row.estimated_homes,
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
          t.center_latitude, t.center_longitude, t.radius_meters
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
          `SELECT id, name, geometry_geojson
          FROM ignore_zones
          WHERE territory_id = ? AND church_id = ?
          ORDER BY created_at, id`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as ExclusionRow[]
    ).map(
      (row): ExclusionArea => ({
        id: row.id,
        name: row.name,
        geometry: parseGeometry<Polygon>(row.geometry_geojson),
      }),
    );
    const center: Position = [territory.center_longitude, territory.center_latitude];
    const radiusMiles = territory.radius_meters / 1609.344;
    const segments = (
      database
        .prepare(
          `SELECT id, source_segment_id, street_name, geometry_geojson, estimated_homes
          FROM street_segments
          WHERE territory_id = ? AND church_id = ?
          ORDER BY street_name, id`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as SegmentRow[]
    ).map((row): TerritorySegment => {
      const geometry = parseGeometry<LineString>(row.geometry_geojson);
      const outsideRadius = !lineInsideCircle(geometry, center, radiusMiles);
      const excluded = exclusions.some((area) => lineIntersectsPolygon(geometry, area.geometry));
      return {
        id: row.id,
        sourceSegmentId: row.source_segment_id ?? row.id,
        streetName: row.street_name,
        geometry,
        estimatedHomes: row.estimated_homes,
        eligible: !outsideRadius && !excluded,
        excludedReason: outsideRadius ? 'radius' : excluded ? 'exclusion' : null,
      };
    });

    return {
      id: territory.id,
      churchName: territory.church_name,
      name: territory.name,
      originAddress: territory.origin_address,
      center,
      radiusMiles,
      exclusions,
      segments,
      totals: {
        allSegments: segments.length,
        eligibleSegments: segments.filter((segment) => segment.eligible).length,
        allHomes: segments.reduce((total, segment) => total + segment.estimatedHomes, 0),
        eligibleHomes: segments
          .filter((segment) => segment.eligible)
          .reduce((total, segment) => total + segment.estimatedHomes, 0),
      },
    };
  } finally {
    database.close();
  }
}

export function saveTerritoryDraft(draft: TerritoryDraftInput, filename?: string): void {
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database
      .prepare(
        `UPDATE territories
        SET origin_address = ?, center_longitude = ?, center_latitude = ?,
          radius_meters = ?, boundary_geojson = ?
        WHERE id = ? AND church_id = ?`,
      )
      .run(
        draft.originAddress,
        draft.center[0],
        draft.center[1],
        draft.radiusMiles * 1609.344,
        JSON.stringify(circleBoundary(draft.center, draft.radiusMiles)),
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
        (id, church_id, territory_id, name, geometry_geojson)
      VALUES (?, ?, ?, ?, ?)`,
    );
    for (const exclusion of draft.exclusions) {
      insert.run(
        exclusion.id,
        PILOT_CHURCH_ID,
        PILOT_TERRITORY_ID,
        exclusion.name,
        JSON.stringify(exclusion.geometry),
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
