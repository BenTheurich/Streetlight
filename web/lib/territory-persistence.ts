import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportedMapBuilding, ImportedTerritoryInput } from './overture-import.ts';
import { openSqliteDatabase } from './sqlite-persistence.ts';
import { apartmentSiteReady } from './territory-client.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  type LineString,
  lineInsideTerritoryBoundary,
  type Position,
  pointInsideTerritoryBoundary,
  territoryBoundary,
} from './territory-geometry.ts';
import type { TerritoryImportMetadata } from './territory-import.ts';
import {
  type ApartmentEvidence,
  type ApartmentSite,
  type ApartmentSiteConfigurationInput,
  ApartmentSiteError,
  type ApartmentSiteMembershipInput,
  type TerritorySegment,
  type TerritoryWorkspace,
} from './territory-workspace.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTerritoryId(): string {
  return requireWorkspaceScope().territoryId;
}

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
  import_spatially_assigned_addresses: number | null;
  import_inferred_roads: number | null;
  import_unmatched_addresses: number | null;
  import_unresolved_clusters: number | null;
  import_total_residential_buildings: number | null;
  import_fallback_buildings: number | null;
  import_unmatched_residential_buildings: number | null;
  import_populated_unnamed_roads: number | null;
  import_building_address_disagreements: number | null;
  import_quality_warnings_json: string;
  import_normalizer_version: number | null;
  import_generation: number;
  import_building_mode: 'overture_fema' | 'overture_only' | null;
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

type ApartmentRow = {
  id?: string;
  import_complex_id: string;
  source_id: string;
  site_name: string | null;
  address: string | null;
  longitude: number;
  latitude: number;
  estimated_tracts: number;
  apartment_building: number;
  distinct_units: number;
  review_status: 'needs_review' | 'ready' | 'deferred';
  boundary_geojson: string | null;
  grouping_kind: 'source_boundary' | 'ungrouped' | 'admin_group';
  grouping_confirmed: number;
  address_confirmed: number;
  confirmed_tracts: number | null;
  access_status: 'unknown' | 'open' | 'restricted';
  included_in_packets: number;
  members_json: string;
  import_generation?: number;
};

function apartmentMembers(value: string): ApartmentEvidence[] {
  return JSON.parse(value) as ApartmentEvidence[];
}

function parseGeometry<T extends LineString | ImportedMapBuilding['geometry']>(json: string): T {
  return JSON.parse(json) as T;
}

export function getTerritoryWorkspace(filename?: string): TerritoryWorkspace {
  const database = openSqliteDatabase(filename);
  try {
    const territory = database
      .prepare(
        `SELECT t.id, c.name AS church_name, t.name, t.origin_address,
          t.center_latitude, t.center_longitude, t.radius_meters, t.boundary_shape,
          t.import_kind, t.import_release, t.import_center_latitude,
          t.import_center_longitude, t.import_radius_meters, t.import_completed_at,
          t.import_total_addresses, t.import_assigned_addresses, t.import_inferred_roads,
          t.import_spatially_assigned_addresses, t.import_unmatched_addresses,
          t.import_unresolved_clusters, t.import_total_residential_buildings,
          t.import_fallback_buildings, t.import_unmatched_residential_buildings,
          t.import_populated_unnamed_roads, t.import_building_address_disagreements,
          t.import_quality_warnings_json,
          t.import_normalizer_version,
          t.import_generation
        FROM territories t
        JOIN churches c ON c.id = t.church_id
        WHERE t.id = ? AND t.church_id = ?`,
      )
      .get(workspaceTerritoryId(), workspaceChurchId()) as TerritoryRow | undefined;
    if (!territory) {
      throw new Error('No local workspace found. Run pnpm db:seed.');
    }

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
              territory.import_spatially_assigned_addresses === null ||
              territory.import_inferred_roads === null ||
              territory.import_unmatched_addresses === null ||
              territory.import_unresolved_clusters === null ||
              territory.import_total_residential_buildings === null ||
              territory.import_fallback_buildings === null ||
              territory.import_unmatched_residential_buildings === null ||
              territory.import_populated_unnamed_roads === null ||
              territory.import_building_address_disagreements === null
                ? null
                : {
                    totalAddresses: territory.import_total_addresses,
                    assignedAddresses: territory.import_assigned_addresses,
                    spatiallyAssignedAddresses: territory.import_spatially_assigned_addresses,
                    inferredRoads: territory.import_inferred_roads,
                    unmatchedAddresses: territory.import_unmatched_addresses,
                    unresolvedClusters: territory.import_unresolved_clusters,
                    totalResidentialBuildings: territory.import_total_residential_buildings,
                    fallbackBuildings: territory.import_fallback_buildings,
                    unmatchedResidentialBuildings: territory.import_unmatched_residential_buildings,
                    populatedUnnamedRoads: territory.import_populated_unnamed_roads,
                    buildingAddressDisagreements: territory.import_building_address_disagreements,
                    warnings: JSON.parse(territory.import_quality_warnings_json) as string[],
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
        .all(workspaceTerritoryId(), workspaceChurchId()) as SegmentRow[]
    ).map((row): TerritorySegment => {
      const geometry = parseGeometry<LineString>(row.geometry_geojson);
      const withinBoundary = lineInsideTerritoryBoundary(
        geometry,
        center,
        radiusMiles,
        boundaryShape,
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
        eligible: active && withinBoundary && !manuallyExcluded,
        excludedReason: !withinBoundary
          ? 'boundary'
          : !active
            ? 'hidden'
            : manuallyExcluded
              ? 'segment'
              : null,
      };
    });
    const apartmentRows = database
      .prepare(
        `SELECT import_complex_id, source_id, site_name, address, longitude, latitude,
          estimated_tracts, apartment_building, distinct_units, review_status,
          boundary_geojson, grouping_kind, grouping_confirmed, address_confirmed,
          confirmed_tracts, access_status, included_in_packets, members_json
        FROM apartment_complexes
        WHERE territory_id = ? AND church_id = ? AND is_current = 1
        ORDER BY grouping_confirmed DESC, site_name, address, import_complex_id`,
      )
      .all(workspaceTerritoryId(), workspaceChurchId()) as ApartmentRow[];
    const claimedEvidenceIds = new Set(
      apartmentRows
        .filter((row) => row.grouping_confirmed === 1)
        .flatMap((row) => apartmentMembers(row.members_json).map(({ id }) => id)),
    );
    const apartmentSites = apartmentRows
      .map((row): ApartmentSite | null => {
        const members = apartmentMembers(row.members_json).filter(
          ({ id }) => row.grouping_confirmed === 1 || !claimedEvidenceIds.has(id),
        );
        if (members.length === 0) return null;
        const base = {
          id: row.import_complex_id,
          sourceId: row.source_id,
          name: row.site_name,
          address: row.address,
          position: [row.longitude, row.latitude] as Position,
          boundary: row.boundary_geojson
            ? (JSON.parse(row.boundary_geojson) as ImportedMapBuilding['geometry'])
            : null,
          groupingKind: row.grouping_kind,
          groupingConfirmed: row.grouping_confirmed === 1,
          addressConfirmed: row.address_confirmed === 1,
          tractCount: row.confirmed_tracts,
          accessStatus: row.access_status,
          includedInPackets: row.included_in_packets === 1,
          members,
        };
        return {
          ...base,
          packetReady: apartmentSiteReady(base),
          estimatedTracts: row.confirmed_tracts ?? Math.max(1, row.distinct_units),
          evidence: {
            apartmentBuilding: members.some(({ apartmentBuilding }) => apartmentBuilding),
            distinctUnits: members.reduce((total, member) => total + member.distinctUnits, 0),
          },
          reviewStatus: row.review_status,
          withinBoundary: pointInsideTerritoryBoundary(
            [row.longitude, row.latitude],
            center,
            radiusMiles,
            boundaryShape,
          ),
        };
      })
      .filter((site): site is ApartmentSite => site !== null);
    const apartmentComplexes = apartmentSites;

    return {
      id: territory.id,
      churchName: territory.church_name,
      name: territory.name,
      originAddress: territory.origin_address,
      center,
      radiusMiles,
      boundaryShape,
      import: imported,
      apartmentSites,
      apartmentComplexes,
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

type PersistTerritoryOptions = {
  filename?: string;
  imported?: ImportedTerritoryInput;
  importJobId?: string;
};

export class TerritoryImportActiveError extends Error {}

function persistTerritoryDraft(draft: TerritoryDraftInput, options: PersistTerritoryOptions): void {
  const database = openSqliteDatabase(options.filename);
  const activatedSegmentIds = new Set(draft.activatedSegmentIds);
  const excludedSegmentIds = new Set(draft.excludedSegmentIds ?? []);
  database.exec('BEGIN IMMEDIATE');
  try {
    if (
      !options.importJobId &&
      database
        .prepare(
          `SELECT 1 FROM territory_import_jobs
          WHERE church_id = ? AND territory_id = ? AND status IN ('queued', 'running')`,
        )
        .get(workspaceChurchId(), workspaceTerritoryId())
    ) {
      throw new TerritoryImportActiveError();
    }
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
        workspaceTerritoryId(),
        workspaceChurchId(),
      );
    if (result.changes !== 1) {
      throw new Error('Territory not found');
    }

    if (options.imported) {
      const preservedApartmentSites = database
        .prepare(
          `SELECT import_complex_id, source_id, site_name, address, longitude, latitude,
            estimated_tracts, apartment_building, distinct_units, review_status,
            boundary_geojson, grouping_kind, grouping_confirmed, address_confirmed,
            confirmed_tracts, access_status, included_in_packets, members_json
          FROM apartment_complexes
          WHERE territory_id = ? AND church_id = ? AND is_current = 1
            AND grouping_confirmed = 1`,
        )
        .all(workspaceTerritoryId(), workspaceChurchId()) as ApartmentRow[];
      const excludedGeometryById = new Map(
        (
          database
            .prepare(
              `SELECT import_segment_id, geometry_geojson
              FROM street_segments
              WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
            )
            .all(workspaceTerritoryId(), workspaceChurchId()) as Array<{
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
        .all(workspaceTerritoryId(), workspaceChurchId()) as Array<
        SegmentRow & { import_segment_id: string }
      >;
      const manualAddresses = new Map<
        string,
        Array<{
          house_number: string | null;
          street: string;
          locality: string | null;
          postcode: string | null;
          longitude: number;
          latitude: number;
        }>
      >();
      for (const row of database
        .prepare(
          `SELECT s.import_segment_id, a.house_number, a.street, a.locality, a.postcode,
            a.longitude, a.latitude
          FROM street_segments s
          JOIN segment_addresses a ON a.street_segment_id = s.id
          WHERE s.territory_id = ? AND s.church_id = ? AND s.is_current = 1
            AND s.activation_kind = 'manual'
          ORDER BY a.id`,
        )
        .all(workspaceTerritoryId(), workspaceChurchId()) as Array<{
        import_segment_id: string;
        house_number: string | null;
        street: string;
        locality: string | null;
        postcode: string | null;
        longitude: number;
        latitude: number;
      }>) {
        const addresses = manualAddresses.get(row.import_segment_id) ?? [];
        addresses.push(row);
        manualAddresses.set(row.import_segment_id, addresses);
      }
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
          activatedSegmentIds.add(segment.id);
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
            .get(workspaceTerritoryId(), workspaceChurchId()) as Pick<
            TerritoryRow,
            'import_generation'
          >
        ).import_generation + 1;
      database
        .prepare(
          `UPDATE street_segments
          SET is_current = 0
          WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
        )
        .run(workspaceTerritoryId(), workspaceChurchId());
      database
        .prepare(
          `UPDATE apartment_complexes
          SET is_current = 0
          WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
        )
        .run(workspaceTerritoryId(), workspaceChurchId());
      const insertSegment = database.prepare(
        `INSERT INTO street_segments
          (id, church_id, territory_id, import_segment_id, source_segment_id, road_group_id,
            road_class, street_name, geometry_geojson, estimated_homes, activation_kind,
            import_generation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertAddress = database.prepare(
        `INSERT INTO segment_addresses
          (street_segment_id, house_number, street, locality, postcode, longitude, latitude)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const segment of options.imported.segments) {
        const geometry = JSON.stringify(segment.geometry);
        const physicalId = `${segment.id}@${generation}`;
        insertSegment.run(
          physicalId,
          workspaceChurchId(),
          workspaceTerritoryId(),
          segment.id,
          segment.sourceSegmentId,
          segment.roadGroupId,
          segment.roadClass,
          segment.streetName,
          geometry,
          segment.estimatedHomes,
          segment.activationKind,
          generation,
        );
        for (const address of segment.addresses) {
          insertAddress.run(
            physicalId,
            address.number,
            address.street,
            address.locality,
            address.postcode,
            address.position[0],
            address.position[1],
          );
        }
        if (excludedGeometryById.get(segment.id) === geometry) {
          excludedSegmentIds.add(segment.id);
        }
      }
      const insertApartment = database.prepare(
        `INSERT INTO apartment_complexes
          (id, church_id, territory_id, import_complex_id, source_id, address, longitude,
            latitude, estimated_tracts, apartment_building, distinct_units, review_status,
            import_generation, site_name, boundary_geojson, grouping_kind, grouping_confirmed,
            address_confirmed, confirmed_tracts, access_status, included_in_packets, members_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const preservedIds = new Set(preservedApartmentSites.map((site) => site.import_complex_id));
      for (const apartment of options.imported.apartmentSites) {
        if (preservedIds.has(apartment.id)) continue;
        const distinctUnits = apartment.members.reduce(
          (total, member) => total + member.distinctUnits,
          0,
        );
        insertApartment.run(
          `${apartment.id}@${generation}`,
          workspaceChurchId(),
          workspaceTerritoryId(),
          apartment.id,
          apartment.sourceId,
          apartment.address,
          apartment.position[0],
          apartment.position[1],
          Math.max(1, distinctUnits),
          apartment.members.some(({ apartmentBuilding }) => apartmentBuilding) ? 1 : 0,
          distinctUnits,
          'needs_review',
          generation,
          apartment.name,
          apartment.boundary ? JSON.stringify(apartment.boundary) : null,
          apartment.groupingKind,
          0,
          0,
          null,
          'unknown',
          0,
          JSON.stringify(apartment.members),
        );
      }
      for (const apartment of preservedApartmentSites) {
        insertApartment.run(
          `${apartment.import_complex_id}@${generation}:preserved`,
          workspaceChurchId(),
          workspaceTerritoryId(),
          apartment.import_complex_id,
          apartment.source_id,
          apartment.address,
          apartment.longitude,
          apartment.latitude,
          apartment.estimated_tracts,
          apartment.apartment_building,
          apartment.distinct_units,
          apartment.review_status,
          generation,
          apartment.site_name,
          apartment.boundary_geojson,
          apartment.grouping_kind,
          apartment.grouping_confirmed,
          apartment.address_confirmed,
          apartment.confirmed_tracts,
          apartment.access_status,
          apartment.included_in_packets,
          apartment.members_json,
        );
      }
      const insertMapBuilding = database.prepare(
        `INSERT INTO map_buildings
          (church_id, territory_id, import_generation, source, source_feature_id,
            geometry_geojson, overture_release, retrieved_at, fema_address_source_id,
            fema_distance_meters, fema_occupancy, fema_outbuilding, fema_source,
            fema_product_date, fema_image_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const building of options.imported.mapBuildings) {
        insertMapBuilding.run(
          workspaceChurchId(),
          workspaceTerritoryId(),
          generation,
          building.source,
          building.sourceId,
          JSON.stringify(building.geometry),
          options.imported.release,
          options.imported.completedAt,
          building.fema?.addressSourceId ?? null,
          building.fema?.distanceMeters ?? null,
          building.fema?.occupancy ?? null,
          building.fema ? 0 : null,
          building.fema?.source ?? null,
          building.fema?.productDate ?? null,
          building.fema?.imageDate ?? null,
        );
      }
      for (const segment of manualRows) {
        if (segment.source_segment_id && importedSourceIds.has(segment.source_segment_id)) {
          continue;
        }
        const physicalId = `${segment.import_segment_id}@${generation}`;
        insertSegment.run(
          physicalId,
          workspaceChurchId(),
          workspaceTerritoryId(),
          segment.import_segment_id,
          segment.source_segment_id,
          segment.road_group_id,
          segment.road_class,
          segment.street_name,
          segment.geometry_geojson,
          segment.estimated_homes,
          'manual',
          generation,
        );
        for (const address of manualAddresses.get(segment.import_segment_id) ?? []) {
          insertAddress.run(
            physicalId,
            address.house_number,
            address.street,
            address.locality,
            address.postcode,
            address.longitude,
            address.latitude,
          );
        }
        activatedSegmentIds.add(segment.import_segment_id);
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
            import_assigned_addresses = ?, import_spatially_assigned_addresses = ?,
            import_inferred_roads = ?, import_unmatched_addresses = ?,
            import_unresolved_clusters = ?, import_total_residential_buildings = ?,
            import_fallback_buildings = ?, import_unmatched_residential_buildings = ?,
            import_populated_unnamed_roads = ?, import_building_address_disagreements = ?,
            import_quality_warnings_json = ?,
            import_normalizer_version = ?, import_generation = ?, import_building_mode = ?
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
          options.imported.quality.spatiallyAssignedAddresses,
          options.imported.quality.inferredRoads,
          options.imported.quality.unmatchedAddresses,
          options.imported.quality.unresolvedClusters,
          options.imported.quality.totalResidentialBuildings,
          options.imported.quality.fallbackBuildings,
          options.imported.quality.unmatchedResidentialBuildings,
          options.imported.quality.populatedUnnamedRoads,
          options.imported.quality.buildingAddressDisagreements,
          JSON.stringify(options.imported.quality.warnings),
          options.imported.normalizerVersion,
          generation,
          options.imported.buildingMode,
          workspaceTerritoryId(),
          workspaceChurchId(),
        );
    }
    const activate = database.prepare(
      `UPDATE street_segments
      SET activation_kind = 'manual'
      WHERE territory_id = ? AND church_id = ? AND is_current = 1 AND import_segment_id = ?`,
    );
    for (const segmentId of activatedSegmentIds) {
      activate.run(workspaceTerritoryId(), workspaceChurchId(), segmentId);
    }
    database
      .prepare(
        `UPDATE street_segments
        SET manually_excluded = 0
        WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
      )
      .run(workspaceTerritoryId(), workspaceChurchId());
    const excludeSegment = database.prepare(
      `UPDATE street_segments
      SET manually_excluded = 1
      WHERE territory_id = ? AND church_id = ? AND is_current = 1
        AND import_segment_id = ?`,
    );
    for (const segmentId of excludedSegmentIds) {
      excludeSegment.run(workspaceTerritoryId(), workspaceChurchId(), segmentId);
    }
    database
      .prepare(
        `UPDATE churches
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      )
      .run(workspaceChurchId());
    if (options.importJobId) {
      const completed = database
        .prepare(
          `UPDATE territory_import_jobs
          SET status = 'succeeded', stage = 'saving', error = NULL,
            completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
            heartbeat_at = CURRENT_TIMESTAMP
          WHERE id = ? AND church_id = ? AND territory_id = ? AND status = 'running'`,
        )
        .run(options.importJobId, workspaceChurchId(), workspaceTerritoryId());
      if (completed.changes !== 1) throw new Error('Territory import job is not running');
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function saveTerritoryDraft(
  draft: TerritoryDraftInput,
  options: { filename?: string } = {},
): TerritoryWorkspace {
  persistTerritoryDraft(draft, options);
  return getTerritoryWorkspace(options.filename);
}

export function replaceTerritoryFromImport(
  draft: TerritoryDraftInput,
  imported: ImportedTerritoryInput,
  options: { filename?: string; importJobId?: string } = {},
): TerritoryWorkspace {
  persistTerritoryDraft(draft, { ...options, imported });
  return getTerritoryWorkspace(options.filename);
}

type CurrentApartmentRow = ApartmentRow & { id: string; import_generation: number };

function currentApartmentSiteRows(database: DatabaseSync): CurrentApartmentRow[] {
  return database
    .prepare(
      `SELECT id, import_complex_id, source_id, site_name, address, longitude, latitude,
        estimated_tracts, apartment_building, distinct_units, review_status,
        boundary_geojson, grouping_kind, grouping_confirmed, address_confirmed,
        confirmed_tracts, access_status, included_in_packets, members_json, import_generation
      FROM apartment_complexes
      WHERE territory_id = ? AND church_id = ? AND is_current = 1
      ORDER BY grouping_confirmed DESC, import_complex_id`,
    )
    .all(workspaceTerritoryId(), workspaceChurchId()) as CurrentApartmentRow[];
}

export function saveApartmentSiteConfiguration(
  input: ApartmentSiteConfigurationInput,
  filename?: string,
): TerritoryWorkspace {
  if (
    !input.id.trim() ||
    !(input.name === null || input.name.trim()) ||
    !(input.address === null || input.address.trim()) ||
    !(
      input.tractCount === null ||
      (Number.isSafeInteger(input.tractCount) && input.tractCount >= 1)
    )
  ) {
    throw new ApartmentSiteError('invalid', 'Invalid apartment site configuration');
  }
  const database = openSqliteDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = currentApartmentSiteRows(database).find(
      ({ import_complex_id }) => import_complex_id === input.id,
    );
    if (!row) throw new ApartmentSiteError('not_found', 'Apartment site not found');
    const next = {
      address: input.address?.trim() || null,
      tractCount: input.tractCount,
      accessStatus: input.accessStatus,
    };
    const ready = apartmentSiteReady(next);
    if (input.includedInPackets && !ready && row.included_in_packets === 0) {
      throw new ApartmentSiteError(
        'not_ready',
        'Add an address, tract quantity, and access before including this apartment site',
      );
    }
    const included = input.includedInPackets && ready;
    const groupingConfirmed = row.grouping_confirmed === 1 || included;
    const addressConfirmed = Boolean(
      next.address && (included || (row.address_confirmed === 1 && row.address === next.address)),
    );
    database
      .prepare(
        `UPDATE apartment_complexes
        SET site_name = ?, address = ?, address_confirmed = ?, confirmed_tracts = ?,
          access_status = ?, grouping_confirmed = ?, included_in_packets = ?,
          review_status = ?
        WHERE id = ? AND church_id = ? AND territory_id = ? AND is_current = 1`,
      )
      .run(
        row.site_name,
        next.address,
        addressConfirmed ? 1 : 0,
        input.tractCount,
        input.accessStatus,
        groupingConfirmed ? 1 : 0,
        included ? 1 : 0,
        included ? 'ready' : 'needs_review',
        row.id,
        workspaceChurchId(),
        workspaceTerritoryId(),
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getTerritoryWorkspace(filename);
}

export function saveApartmentSiteMembership(
  input: ApartmentSiteMembershipInput,
  filename?: string,
): TerritoryWorkspace {
  if (
    input.memberIds.length === 0 ||
    new Set(input.memberIds).size !== input.memberIds.length ||
    input.memberIds.some((id) => !id.trim())
  ) {
    throw new ApartmentSiteError('invalid', 'Select at least one unique apartment building');
  }
  const database = openSqliteDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const rows = currentApartmentSiteRows(database);
    const target = input.id
      ? rows.find(({ import_complex_id }) => import_complex_id === input.id)
      : undefined;
    if (input.id && !target) throw new ApartmentSiteError('not_found', 'Apartment site not found');
    const targetMembers = target ? apartmentMembers(target.members_json) : [];
    const targetMemberIds = new Set(targetMembers.map(({ id }) => id));
    const evidence = new Map<string, ApartmentEvidence>();
    const confirmedOwner = new Map<string, string>();
    for (const row of rows) {
      for (const member of apartmentMembers(row.members_json)) {
        evidence.set(member.id, member);
        if (row.grouping_confirmed === 1) confirmedOwner.set(member.id, row.import_complex_id);
      }
    }
    for (const memberId of input.memberIds) {
      if (!evidence.has(memberId)) {
        throw new ApartmentSiteError('not_found', 'Apartment evidence not found');
      }
      const owner = confirmedOwner.get(memberId);
      if (owner && owner !== input.id) {
        throw new ApartmentSiteError('member_conflict', 'Apartment evidence is already grouped');
      }
    }

    const requested = new Set(input.memberIds);
    const affected = new Set([...requested, ...targetMemberIds]);
    const retiredRows = rows.filter(
      (row) =>
        row.id !== target?.id &&
        row.grouping_confirmed === 0 &&
        apartmentMembers(row.members_json).some(({ id }) => affected.has(id)),
    );
    const retiredEvidence = new Map<string, ApartmentEvidence>();
    for (const row of retiredRows) {
      for (const member of apartmentMembers(row.members_json))
        retiredEvidence.set(member.id, member);
      database.prepare('UPDATE apartment_complexes SET is_current = 0 WHERE id = ?').run(row.id);
    }
    for (const member of targetMembers) retiredEvidence.set(member.id, member);
    const selectedMembers = input.memberIds.map((id) => evidence.get(id) as ApartmentEvidence);
    const longitude =
      selectedMembers.reduce((total, member) => total + member.position[0], 0) /
      selectedMembers.length;
    const latitude =
      selectedMembers.reduce((total, member) => total + member.position[1], 0) /
      selectedMembers.length;
    const generation = (
      database
        .prepare('SELECT import_generation FROM territories WHERE id = ? AND church_id = ?')
        .get(workspaceTerritoryId(), workspaceChurchId()) as { import_generation: number }
    ).import_generation;
    const distinctUnits = selectedMembers.reduce(
      (total, member) => total + member.distinctUnits,
      0,
    );

    if (target) {
      database
        .prepare(
          `UPDATE apartment_complexes
          SET longitude = ?, latitude = ?, estimated_tracts = ?, apartment_building = ?,
            distinct_units = ?, boundary_geojson = NULL, grouping_kind = 'admin_group',
            grouping_confirmed = 1, included_in_packets = 0, review_status = 'needs_review',
            members_json = ?
          WHERE id = ?`,
        )
        .run(
          longitude,
          latitude,
          Math.max(1, distinctUnits),
          selectedMembers.some(({ apartmentBuilding }) => apartmentBuilding) ? 1 : 0,
          distinctUnits,
          JSON.stringify(selectedMembers),
          target.id,
        );
    } else {
      const logicalId = `admin-apartment-site:${randomUUID()}`;
      database
        .prepare(
          `INSERT INTO apartment_complexes
            (id, church_id, territory_id, import_complex_id, source_id, address, longitude,
              latitude, estimated_tracts, apartment_building, distinct_units, review_status,
              import_generation, grouping_kind, grouping_confirmed, members_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, 'admin_group', 1, ?)`,
        )
        .run(
          `${logicalId}@${generation}`,
          workspaceChurchId(),
          workspaceTerritoryId(),
          logicalId,
          selectedMembers[0].sourceId,
          selectedMembers.find(({ address }) => address)?.address ?? null,
          longitude,
          latitude,
          Math.max(1, distinctUnits),
          selectedMembers.some(({ apartmentBuilding }) => apartmentBuilding) ? 1 : 0,
          distinctUnits,
          generation,
          JSON.stringify(selectedMembers),
        );
    }

    const represented = new Set(
      currentApartmentSiteRows(database).flatMap((row) =>
        apartmentMembers(row.members_json).map(({ id }) => id),
      ),
    );
    const insertUngrouped = database.prepare(
      `INSERT INTO apartment_complexes
        (id, church_id, territory_id, import_complex_id, source_id, address, longitude,
          latitude, estimated_tracts, apartment_building, distinct_units, review_status,
          import_generation, grouping_kind, grouping_confirmed, members_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, 'ungrouped', 0, ?)`,
    );
    for (const member of retiredEvidence.values()) {
      if (requested.has(member.id) || represented.has(member.id)) continue;
      insertUngrouped.run(
        `${member.id}@${generation}:restored:${randomUUID()}`,
        workspaceChurchId(),
        workspaceTerritoryId(),
        member.id,
        member.sourceId,
        member.address,
        member.position[0],
        member.position[1],
        Math.max(1, member.distinctUnits),
        member.apartmentBuilding ? 1 : 0,
        member.distinctUnits,
        generation,
        JSON.stringify([member]),
      );
      represented.add(member.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getTerritoryWorkspace(filename);
}
