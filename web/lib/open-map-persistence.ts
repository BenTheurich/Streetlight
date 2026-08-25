import { getCoverageWorkspace } from './coverage-persistence.ts';
import type { OpenMapData } from './open-map-data.ts';
import type { ImportedMapBuilding } from './overture-import.ts';
import { openSqliteDatabase } from './sqlite-persistence.ts';
import { type LineString, type Position, territoryBoundary } from './territory-geometry.ts';
import { OVERTURE_RELEASE } from './territory-import.ts';
import { getTerritoryWorkspace } from './territory-persistence.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTerritoryId(): string {
  return requireWorkspaceScope().territoryId;
}

function parseGeometry<T extends LineString | ImportedMapBuilding['geometry']>(json: string): T {
  return JSON.parse(json) as T;
}

export function getOpenMapData(filename?: string): OpenMapData {
  const territory = getTerritoryWorkspace(filename);
  const coverage = getCoverageWorkspace(filename);
  const boundary = territoryBoundary(
    territory.center,
    territory.radiusMiles,
    territory.boundaryShape,
  );
  const points = boundary.coordinates[0];
  const roadClasses = new Map(territory.segments.map(({ id, roadClass }) => [id, roadClass]));
  const database = openSqliteDatabase(filename);
  try {
    const generation = database
      .prepare(
        `SELECT import_generation, import_release, import_building_mode
        FROM territories
        WHERE church_id = ? AND id = ?`,
      )
      .get(workspaceChurchId(), workspaceTerritoryId()) as
      | {
          import_generation: number;
          import_release: string | null;
          import_building_mode: 'overture_fema' | 'overture_only' | null;
        }
      | undefined;
    if (!generation) throw new Error('Territory not found');
    const buildings = (
      database
        .prepare(
          `SELECT source, source_feature_id, geometry_geojson,
            fema_address_source_id, fema_distance_meters, fema_source,
            fema_product_date, fema_image_date
          FROM map_buildings
          WHERE church_id = ? AND territory_id = ? AND import_generation = ?
          ORDER BY source, source_feature_id`,
        )
        .all(workspaceChurchId(), workspaceTerritoryId(), generation.import_generation) as Array<{
        source: 'overture' | 'fema';
        source_feature_id: string;
        geometry_geojson: string;
        fema_address_source_id: string | null;
        fema_distance_meters: number | null;
        fema_source: string | null;
        fema_product_date: string | null;
        fema_image_date: string | null;
      }>
    ).map(
      (building): ImportedMapBuilding => ({
        source: building.source,
        sourceId: building.source_feature_id,
        geometry: parseGeometry<ImportedMapBuilding['geometry']>(building.geometry_geojson),
        fema:
          building.source === 'fema'
            ? {
                addressSourceId: building.fema_address_source_id as string,
                distanceMeters: building.fema_distance_meters as number,
                occupancy: 'Single Family Dwelling',
                outbuilding: false,
                source: building.fema_source,
                productDate: building.fema_product_date,
                imageDate: building.fema_image_date,
              }
            : null,
      }),
    );
    const houseNumbers = (
      database
        .prepare(
          `SELECT a.house_number, a.street, a.longitude, a.latitude
          FROM segment_addresses a
          JOIN street_segments s ON s.id = a.street_segment_id
          WHERE s.church_id = ? AND s.territory_id = ? AND s.is_current = 1
            AND a.house_number IS NOT NULL AND length(trim(a.house_number)) > 0
          ORDER BY a.id`,
        )
        .all(workspaceChurchId(), workspaceTerritoryId()) as Array<{
        house_number: string;
        street: string;
        longitude: number;
        latitude: number;
      }>
    ).map(({ house_number, street, longitude, latitude }) => ({
      number: house_number.trim(),
      street: street.trim(),
      position: [longitude, latitude] as Position,
    }));
    return {
      churchId: workspaceChurchId(),
      territoryId: workspaceTerritoryId(),
      territoryName: territory.name,
      center: territory.center,
      bounds: [
        Math.min(...points.map(([longitude]) => longitude)),
        Math.min(...points.map(([, latitude]) => latitude)),
        Math.max(...points.map(([longitude]) => longitude)),
        Math.max(...points.map(([, latitude]) => latitude)),
      ],
      boundary,
      importGeneration: generation.import_generation,
      overtureRelease: generation.import_release ?? OVERTURE_RELEASE,
      buildingMode: generation.import_building_mode ?? 'overture_only',
      segments: coverage.segments.map((segment) => ({
        ...segment,
        roadClass: roadClasses.get(segment.id) ?? 'residential',
      })),
      apartmentComplexes: coverage.apartmentComplexes,
      buildings,
      houseNumbers,
      attribution: {
        base: 'OpenFreeMap © OpenMapTiles',
        roads: 'Data from OpenStreetMap',
        buildings: 'Overture Maps',
        fema: buildings.some(({ source }) => source === 'fema') ? 'FEMA USA Structures' : null,
      },
    };
  } finally {
    database.close();
  }
}
