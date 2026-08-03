import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type CoverageClass,
  type CoverageLegendItem,
  type CoverageRoot,
  type CoverageThresholds,
  calendarDateInTimeZone,
  classifyCoverage,
  coverageLegend,
  deriveCoverageSegments,
  parseCoverageThresholds,
  validateCoverageDate,
} from './coverage.ts';
import type { ImportedMapBuilding, ImportedTerritoryInput } from './overture-import.ts';
import {
  type DownloadPacket,
  type FinalizedBatch,
  type PacketDownloadSelection,
  type PacketFinalizationInput,
  PacketProposalConflictError,
  packetProposalFingerprint,
} from './packet-finalization.ts';
import {
  type ApartmentPacketCandidate,
  generatePacketProposals,
  type PacketAddress,
  type PacketSelectionSegment,
} from './packet-selection.ts';
import {
  type PacketCompletionCorrectionInput,
  type PacketCoverageHistory,
  parsePacketCompletionCorrection,
  parseReconciliationInput,
  type ReconciliationBatch,
  ReconciliationConflictError,
  type ReconciliationInput,
  type ReconciliationPacket,
  type ReconciliationWorkspace,
} from './reconciliation.ts';
import { type ChurchPrintoutSettings, parseChurchPrintoutSettings } from './settings.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  type LineString,
  lineInsideTerritoryBoundary,
  type Polygon,
  type Position,
  pointInsideTerritoryBoundary,
  territoryBoundary,
} from './territory-geometry.ts';
import type { TerritoryImportMetadata } from './territory-import.ts';
import { OVERTURE_RELEASE } from './territory-import.ts';
import { requireWorkspaceScope, type WorkspaceScope } from './workspace-scope.ts';

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTerritoryId(): string {
  return requireWorkspaceScope().territoryId;
}

function workspaceTimeZone(): string {
  return requireWorkspaceScope().timeZone;
}

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
  import_complex_id: string;
  source_id: string;
  address: string | null;
  longitude: number;
  latitude: number;
  estimated_tracts: number;
  apartment_building: number;
  distinct_units: number;
  review_status: 'needs_review' | 'ready' | 'deferred';
};

export type FoundationSummary = {
  churchName: string;
  territoryName: string;
  segmentCount: number;
  estimatedHomes: number;
  packetCount: number;
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
  excludedReason: 'hidden' | 'boundary' | 'segment' | null;
};

export type ApartmentComplex = {
  id: string;
  sourceId: string;
  address: string | null;
  position: Position;
  estimatedTracts: number;
  evidence: { apartmentBuilding: boolean; distinctUnits: number };
  reviewStatus: 'needs_review' | 'ready' | 'deferred';
  withinBoundary: boolean;
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
  apartmentComplexes: ApartmentComplex[];
  segments: TerritorySegment[];
  totals: {
    allSegments: number;
    eligibleSegments: number;
    allHomes: number;
    eligibleHomes: number;
  };
};

export type CoverageWorkspaceSegment = Pick<
  TerritorySegment,
  | 'id'
  | 'roadGroupId'
  | 'streetName'
  | 'geometry'
  | 'estimatedHomes'
  | 'eligible'
  | 'excludedReason'
> & {
  lastCoveredOn: string | null;
  coverageClass: CoverageClass;
  roots: CoverageRoot[];
};

export type CoverageWorkspaceApartment = ApartmentComplex & {
  lastCoveredOn: string | null;
  coverageClass: CoverageClass;
  roots: CoverageRoot[];
};

export type CoverageWorkspace = {
  id: string;
  churchName: string;
  name: string;
  center: Position;
  asOf: string;
  activePackets: number;
  latestBatch: {
    id: string;
    name: string;
    packetCount: number;
    estimatedHomes: number;
  } | null;
  thresholds: CoverageThresholds;
  legend: CoverageLegendItem[];
  dataMode: 'canonical' | 'demo';
  qualityWarnings: string[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  segments: CoverageWorkspaceSegment[];
  totals: { eligibleHomes: number };
};

export type OpenMapData = {
  churchId: string;
  territoryId: string;
  territoryName: string;
  center: Position;
  bounds: [number, number, number, number];
  boundary: Polygon;
  importGeneration: number;
  overtureRelease: string;
  buildingMode: 'overture_fema' | 'overture_only';
  segments: Array<
    CoverageWorkspaceSegment & {
      roadClass: string;
    }
  >;
  apartmentComplexes: CoverageWorkspaceApartment[];
  buildings: Array<
    ImportedMapBuilding & {
      address?: { number: string; street: string };
    }
  >;
  houseNumbers: Array<{ number: string; street: string; position: Position }>;
  attribution: {
    base: string;
    roads: string;
    buildings: string;
    fema: string | null;
  };
};

export type PacketGenerationWorkspace = {
  center: Position;
  segments: PacketSelectionSegment[];
  apartmentComplexes: ApartmentPacketCandidate[];
};

type FinalizePacketBatchOptions = {
  filename?: string;
  now?: Date;
  asOf?: string;
};

function workspaceDatabaseFilename(filename?: string): string {
  return (
    filename ??
    process.env.STREETLIGHT_DATABASE_PATH ??
    path.join(process.cwd(), 'data', 'streetlight.db')
  );
}

function openWorkspaceDatabase(filename?: string): DatabaseSync {
  const database = new DatabaseSync(workspaceDatabaseFilename(filename));
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

export type OrganizationAccess = {
  churchId: string;
  churchName: string;
  timeZone: string;
  territoryId: string | null;
  onboardingCompleted: boolean;
};

export function getOrganizationAccess(
  organizationId: string,
  filename?: string,
): OrganizationAccess {
  if (!organizationId) throw new Error('Church workspace not found');
  const database = openWorkspaceDatabase(filename);
  try {
    const rows = database
      .prepare(
        `SELECT c.id AS church_id, c.name AS church_name, c.time_zone,
          c.onboarding_completed_at, t.id AS territory_id
        FROM churches c
        LEFT JOIN territories t ON t.church_id = c.id
        WHERE c.auth_organization_id = ?
        ORDER BY t.created_at, t.id
        LIMIT 2`,
      )
      .all(organizationId) as Array<{
      church_id: string;
      church_name: string;
      time_zone: string;
      onboarding_completed_at: string | null;
      territory_id: string | null;
    }>;
    if (rows.length !== 1) throw new Error('Church workspace not found');
    return {
      churchId: rows[0].church_id,
      churchName: rows[0].church_name,
      timeZone: rows[0].time_zone,
      territoryId: rows[0].territory_id,
      onboardingCompleted: rows[0].onboarding_completed_at !== null,
    };
  } finally {
    database.close();
  }
}

export function getWorkspaceForOrganization(
  organizationId: string,
  filename?: string,
): WorkspaceScope {
  const access = getOrganizationAccess(organizationId, filename);
  if (!access.territoryId) throw new Error('Church workspace not found');
  return {
    churchId: access.churchId,
    territoryId: access.territoryId,
    timeZone: access.timeZone,
  };
}

export function createInitialTerritory(
  organizationId: string,
  input: {
    churchName: string;
    timeZone: string;
    formattedAddress: string;
    center: Position;
  },
  filename?: string,
): { territoryId: string } {
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const church = database
      .prepare(
        `SELECT id
        FROM churches
        WHERE auth_organization_id = ?`,
      )
      .get(organizationId) as { id: string } | undefined;
    if (!church) throw new Error('Church workspace not found');
    const existing = database
      .prepare('SELECT id FROM territories WHERE church_id = ?')
      .get(church.id) as { id: string } | undefined;
    if (existing) throw new Error('Church onboarding is already complete');

    database
      .prepare('UPDATE churches SET name = ?, time_zone = ? WHERE id = ?')
      .run(input.churchName, input.timeZone, church.id);
    const territoryId = `territory-${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address, boundary_shape)
        VALUES (?, ?, 'Outreach territory', ?, ?, ?, ?, ?, 'circle')`,
      )
      .run(
        territoryId,
        church.id,
        input.center[1],
        input.center[0],
        1609.344,
        JSON.stringify(territoryBoundary(input.center, 1, 'circle')),
        input.formattedAddress,
      );
    database.exec('COMMIT');
    return { territoryId };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

function parseGeometry<T extends LineString | ImportedMapBuilding['geometry']>(json: string): T {
  return JSON.parse(json) as T;
}

function todayForWorkspace(): string {
  return calendarDateInTimeZone(new Date(), workspaceTimeZone());
}

export function getChurchPrintoutSettings(filename?: string): ChurchPrintoutSettings {
  const database = openWorkspaceDatabase(filename);
  try {
    const row = database
      .prepare(
        `SELECT packet_footer_message, packet_footer_reference
        FROM churches
        WHERE id = ?`,
      )
      .get(workspaceChurchId()) as
      | { packet_footer_message: string; packet_footer_reference: string }
      | undefined;
    if (!row) throw new Error('Church workspace not found');
    return { message: row.packet_footer_message, reference: row.packet_footer_reference };
  } finally {
    database.close();
  }
}

export function saveChurchPrintoutSettings(
  value: unknown,
  filename?: string,
): ChurchPrintoutSettings {
  const settings = parseChurchPrintoutSettings(value);
  const database = openWorkspaceDatabase(filename);
  try {
    if (
      database
        .prepare(
          `UPDATE churches
          SET packet_footer_message = ?, packet_footer_reference = ?
          WHERE id = ?`,
        )
        .run(settings.message, settings.reference, workspaceChurchId()).changes !== 1
    ) {
      throw new Error('Church workspace not found');
    }
    return settings;
  } finally {
    database.close();
  }
}

export function getCoverageWorkspace(
  filename?: string,
  asOf = todayForWorkspace(),
): CoverageWorkspace {
  validateCoverageDate(asOf, asOf);
  const territory = getTerritoryWorkspace(filename);
  const database = openWorkspaceDatabase(filename);
  try {
    const thresholdRow = database
      .prepare(
        `SELECT coverage_yellow_after_days, coverage_orange_after_days,
          coverage_red_after_days
        FROM territories
        WHERE id = ? AND church_id = ?`,
      )
      .get(workspaceTerritoryId(), workspaceChurchId()) as
      | {
          coverage_yellow_after_days: number;
          coverage_orange_after_days: number;
          coverage_red_after_days: number;
        }
      | undefined;
    if (!thresholdRow) throw new Error('Territory not found');
    const thresholds = parseCoverageThresholds({
      yellowAfterDays: thresholdRow.coverage_yellow_after_days,
      orangeAfterDays: thresholdRow.coverage_orange_after_days,
      redAfterDays: thresholdRow.coverage_red_after_days,
    });
    const events = database
      .prepare(
        `SELECT ce.id, s.import_segment_id AS segment_id, ce.rowid AS sequence,
          ce.packet_id, ce.covered_on, ce.kind, ce.corrects_event_id, ce.is_void
        FROM coverage_events ce
        JOIN street_segments s ON s.id = ce.street_segment_id
        WHERE ce.church_id = ? AND s.territory_id = ?
        ORDER BY ce.rowid`,
      )
      .all(workspaceChurchId(), workspaceTerritoryId())
      .map((row) => {
        const event = row as {
          id: string;
          segment_id: string;
          sequence: number;
          packet_id: string | null;
          covered_on: string;
          kind: 'completed' | 'correction';
          corrects_event_id: string | null;
          is_void: number;
        };
        return {
          id: event.id,
          segmentId: event.segment_id,
          packetId: event.packet_id,
          sequence: event.sequence,
          coveredOn: event.covered_on,
          kind: event.kind,
          correctsEventId: event.corrects_event_id,
          isVoid: event.is_void === 1,
        };
      });
    const apartmentEvents = database
      .prepare(
        `SELECT ce.id, a.import_complex_id AS complex_id, ce.rowid AS sequence,
          ce.packet_id, ce.covered_on, ce.kind, ce.corrects_event_id, ce.is_void
        FROM coverage_events ce
        JOIN apartment_complexes a ON a.id = ce.apartment_complex_id
        WHERE ce.church_id = ? AND a.territory_id = ?
        ORDER BY ce.rowid`,
      )
      .all(workspaceChurchId(), workspaceTerritoryId())
      .map((row) => {
        const event = row as {
          id: string;
          complex_id: string;
          sequence: number;
          packet_id: string | null;
          covered_on: string;
          kind: 'completed' | 'correction';
          corrects_event_id: string | null;
          is_void: number;
        };
        return {
          id: event.id,
          segmentId: event.complex_id,
          packetId: event.packet_id,
          sequence: event.sequence,
          coveredOn: event.covered_on,
          kind: event.kind,
          correctsEventId: event.corrects_event_id,
          isVoid: event.is_void === 1,
        };
      });
    const derived = new Map(
      deriveCoverageSegments(
        events,
        asOf,
        territory.segments.map(({ id, estimatedHomes, eligible }) => ({
          id,
          estimatedHomes,
          eligible,
        })),
      ).map((segment) => [segment.id, segment]),
    );
    const apartmentDerived = new Map(
      deriveCoverageSegments(
        apartmentEvents,
        asOf,
        territory.apartmentComplexes.map((apartment) => ({
          id: apartment.id,
          estimatedHomes: apartment.estimatedTracts,
          eligible: apartment.withinBoundary && apartment.reviewStatus === 'ready',
        })),
      ).map((apartment) => [apartment.id, apartment]),
    );
    const activePackets = (
      database
        .prepare('SELECT COUNT(*) AS count FROM packets WHERE church_id = ? AND status = ?')
        .get(workspaceChurchId(), 'active') as { count: number }
    ).count;
    const latestBatchRow = database
      .prepare(
        `SELECT b.id, b.name, COUNT(p.id) AS packet_count,
          COALESCE(SUM(p.estimated_homes), 0) AS estimated_homes
        FROM batches b
        JOIN packets p ON p.batch_id = b.id AND p.church_id = b.church_id
        WHERE b.church_id = ? AND b.finalized_at IS NOT NULL
        GROUP BY b.id
        ORDER BY b.finalized_at DESC, b.id DESC
        LIMIT 1`,
      )
      .get(workspaceChurchId()) as
      | {
          id: string;
          name: string;
          packet_count: number;
          estimated_homes: number;
        }
      | undefined;

    return {
      id: territory.id,
      churchName: territory.churchName,
      name: territory.name,
      center: territory.center,
      asOf,
      activePackets,
      latestBatch: latestBatchRow
        ? {
            id: latestBatchRow.id,
            name: latestBatchRow.name,
            packetCount: latestBatchRow.packet_count,
            estimatedHomes: latestBatchRow.estimated_homes,
          }
        : null,
      thresholds,
      legend: coverageLegend(thresholds),
      dataMode:
        path.basename(workspaceDatabaseFilename(filename)).toLowerCase() === 'coverage-demo.db'
          ? 'demo'
          : 'canonical',
      qualityWarnings: territory.import.quality?.warnings ?? [],
      apartmentComplexes: territory.apartmentComplexes
        .filter(({ withinBoundary }) => withinBoundary)
        .map((apartment) => {
          const coverage = apartmentDerived.get(apartment.id);
          if (!coverage) throw new Error('Apartment coverage missing');
          return {
            ...apartment,
            lastCoveredOn: coverage.lastCoveredOn,
            coverageClass: classifyCoverage(coverage.lastCoveredOn, asOf, thresholds),
            roots: coverage.roots,
          };
        }),
      segments: territory.segments
        .filter(
          (segment) => segment.excludedReason !== 'boundary' && segment.excludedReason !== 'hidden',
        )
        .map((segment) => {
          const coverage = derived.get(segment.id);
          if (!coverage) throw new Error('Coverage segment missing');
          return {
            id: segment.id,
            roadGroupId: segment.roadGroupId,
            streetName: segment.streetName,
            geometry: segment.geometry,
            estimatedHomes: segment.estimatedHomes,
            eligible: segment.eligible,
            excludedReason: segment.excludedReason,
            lastCoveredOn: coverage.lastCoveredOn,
            coverageClass: classifyCoverage(coverage.lastCoveredOn, asOf, thresholds),
            roots: coverage.roots,
          };
        }),
      totals: { eligibleHomes: territory.totals.eligibleHomes },
    };
  } finally {
    database.close();
  }
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
  const database = openWorkspaceDatabase(filename);
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

export function getPacketGenerationWorkspace(
  filename?: string,
  asOf = todayForWorkspace(),
): PacketGenerationWorkspace {
  const coverage = getCoverageWorkspace(filename, asOf);
  const database = openWorkspaceDatabase(filename);
  try {
    const addresses = new Map<string, PacketAddress[]>();
    for (const row of database
      .prepare(
        `SELECT s.import_segment_id, a.house_number, a.street, a.locality, a.postcode,
          a.longitude, a.latitude
        FROM street_segments s
        JOIN segment_addresses a ON a.street_segment_id = s.id
        WHERE s.territory_id = ? AND s.church_id = ? AND s.is_current = 1
        ORDER BY s.import_segment_id, a.id`,
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
      const segmentAddresses = addresses.get(row.import_segment_id) ?? [];
      segmentAddresses.push({
        number: row.house_number,
        street: row.street,
        locality: row.locality,
        postcode: row.postcode,
        position: [row.longitude, row.latitude],
      });
      addresses.set(row.import_segment_id, segmentAddresses);
    }
    const reserved = new Set(
      (
        database
          .prepare(
            `SELECT DISTINCT s.import_segment_id
            FROM packet_segments ps
            JOIN packets p ON p.id = ps.packet_id AND p.church_id = ps.church_id
            JOIN street_segments s ON s.id = ps.street_segment_id
            WHERE ps.church_id = ? AND s.territory_id = ? AND p.status = 'active'
            ORDER BY s.import_segment_id`,
          )
          .all(workspaceChurchId(), workspaceTerritoryId()) as Array<{ import_segment_id: string }>
      ).map((row) => row.import_segment_id),
    );
    const reservedApartments = new Set(
      (
        database
          .prepare(
            `SELECT DISTINCT a.import_complex_id
            FROM packet_apartment_complexes pa
            JOIN packets p ON p.id = pa.packet_id AND p.church_id = pa.church_id
            JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
            WHERE pa.church_id = ? AND a.territory_id = ? AND p.status = 'active'
            ORDER BY a.import_complex_id`,
          )
          .all(workspaceChurchId(), workspaceTerritoryId()) as Array<{ import_complex_id: string }>
      ).map((row) => row.import_complex_id),
    );
    const apartmentComplexes = coverage.apartmentComplexes
      .filter(
        (apartment) =>
          apartment.withinBoundary && apartment.reviewStatus === 'ready' && apartment.address,
      )
      .map(
        (apartment): ApartmentPacketCandidate => ({
          id: apartment.id,
          address: apartment.address as string,
          position: apartment.position,
          estimatedTracts: apartment.estimatedTracts,
          eligible: true,
          reserved: reservedApartments.has(apartment.id),
          coverageClass: apartment.coverageClass,
          lastCoveredOn: apartment.lastCoveredOn,
        }),
      );
    return {
      center: coverage.center,
      segments: coverage.segments.map(
        ({
          id,
          streetName,
          geometry,
          estimatedHomes,
          eligible,
          coverageClass,
          lastCoveredOn,
        }): PacketSelectionSegment => ({
          id,
          streetName,
          geometry,
          estimatedHomes,
          eligible,
          reserved: reserved.has(id),
          coverageClass,
          lastCoveredOn,
          addresses: addresses.get(id) ?? [],
        }),
      ),
      apartmentComplexes,
    };
  } finally {
    database.close();
  }
}

function automaticBatchName(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: workspaceTimeZone(),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `Outreach batch - ${value('month')} ${value('day')}, ${value('year')}, ${value('hour')}:${value('minute')} ${value('dayPeriod')}`;
}

function packetCode(batchId: string, sequence: number, now: Date): string {
  const date = calendarDateInTimeZone(now, workspaceTimeZone()).replaceAll('-', '');
  const token = batchId.replaceAll('-', '').slice(0, 6).toUpperCase();
  return `TEM-${date}-${token}-${String(sequence + 1).padStart(3, '0')}`;
}

export function finalizePacketBatch(
  input: PacketFinalizationInput,
  options: FinalizePacketBatchOptions = {},
): FinalizedBatch {
  const customName = input.customName?.trim() || null;
  if (customName && customName.length > 80) throw new Error('Invalid batch name');
  const now = options.now ?? new Date();
  const finalizedAt = now.toISOString();
  const database = openWorkspaceDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const generatedProposals = generatePacketProposals({
      ...getPacketGenerationWorkspace(options.filename, options.asOf ?? todayForWorkspace()),
      requests: input.requests,
    }).proposals;
    if (
      generatedProposals.length === 0 ||
      packetProposalFingerprint(generatedProposals) !== input.proposalFingerprint ||
      input.proposalIndexes.length === 0 ||
      input.proposalIndexes.some(
        (index, position, indexes) =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= generatedProposals.length ||
          (position > 0 && index <= indexes[position - 1]),
      )
    ) {
      throw new PacketProposalConflictError('Packet proposals changed');
    }
    const proposals = input.proposalIndexes.map((index) => generatedProposals[index]);

    const batchId = randomUUID();
    const name = customName ?? automaticBatchName(now);
    const importGeneration = (
      database
        .prepare(
          `SELECT import_generation
          FROM territories WHERE id = ? AND church_id = ?`,
        )
        .get(workspaceTerritoryId(), workspaceChurchId()) as { import_generation: number }
    ).import_generation;
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at, import_generation)
        VALUES (?, ?, ?, 'finalized', ?, ?)`,
      )
      .run(batchId, workspaceChurchId(), name, finalizedAt, importGeneration);
    const insertPacket = database.prepare(
      `INSERT INTO packets
        (id, church_id, batch_id, packet_code, start_address, estimated_homes, status,
          sequence_number, start_longitude, start_latitude, packet_kind)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    );
    const segmentRow = database.prepare(
      `SELECT id FROM street_segments
      WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
    );
    const insertSegment = database.prepare(
      `INSERT INTO packet_segments
        (church_id, packet_id, street_segment_id, sequence_number)
      VALUES (?, ?, ?, ?)`,
    );
    const apartmentRow = database.prepare(
      `SELECT id FROM apartment_complexes
      WHERE church_id = ? AND territory_id = ? AND import_complex_id = ? AND is_current = 1`,
    );
    const insertApartment = database.prepare(
      `INSERT INTO packet_apartment_complexes (church_id, packet_id, apartment_complex_id)
      VALUES (?, ?, ?)`,
    );
    const packets = proposals.map((proposal, sequence) => {
      const id = randomUUID();
      const code = packetCode(batchId, sequence, now);
      insertPacket.run(
        id,
        workspaceChurchId(),
        batchId,
        code,
        proposal.start.address,
        proposal.estimatedHomes,
        sequence,
        proposal.start.position[0],
        proposal.start.position[1],
        proposal.kind ?? 'street',
      );
      proposal.segments.forEach((segment, segmentSequence) => {
        const row = segmentRow.get(workspaceChurchId(), workspaceTerritoryId(), segment.id) as
          | { id: string }
          | undefined;
        if (!row) throw new PacketProposalConflictError('Packet proposals changed');
        insertSegment.run(workspaceChurchId(), id, row.id, segmentSequence);
      });
      if (proposal.kind === 'apartment') {
        if (!proposal.apartmentId) {
          throw new PacketProposalConflictError('Packet proposals changed');
        }
        const row = apartmentRow.get(
          workspaceChurchId(),
          workspaceTerritoryId(),
          proposal.apartmentId,
        ) as { id: string } | undefined;
        if (!row) throw new PacketProposalConflictError('Packet proposals changed');
        insertApartment.run(workspaceChurchId(), id, row.id);
      }
      return { ...proposal, id, code };
    });
    database.exec('COMMIT');
    return {
      id: batchId,
      name,
      finalizedAt,
      packetCount: packets.length,
      estimatedHomes: packets.reduce((total, packet) => total + packet.estimatedHomes, 0),
      packets,
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function getPacketDownloadSelection(
  scope: 'newest' | 'active',
  filename?: string,
): PacketDownloadSelection {
  const database = openWorkspaceDatabase(filename);
  try {
    const newest =
      scope === 'newest'
        ? (database
            .prepare(
              `SELECT id FROM batches
              WHERE church_id = ? AND finalized_at IS NOT NULL
              ORDER BY finalized_at DESC, id DESC LIMIT 1`,
            )
            .get(workspaceChurchId()) as { id: string } | undefined)
        : undefined;
    const rows = database
      .prepare(
        `SELECT p.id, p.packet_code, p.batch_id, b.name AS batch_name, p.estimated_homes,
          p.start_address, p.start_longitude, p.start_latitude, p.packet_kind,
          b.import_generation,
          a.import_complex_id
        FROM packets p
        JOIN batches b ON b.id = p.batch_id AND b.church_id = p.church_id
        LEFT JOIN packet_apartment_complexes pa ON pa.packet_id = p.id AND pa.church_id = p.church_id
        LEFT JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
        WHERE p.church_id = ?
          AND (${scope === 'newest' ? 'p.batch_id = ?' : "p.status = 'active'"})
        ORDER BY b.finalized_at, b.id, p.sequence_number, p.id`,
      )
      .all(workspaceChurchId(), ...(scope === 'newest' ? [newest?.id ?? ''] : [])) as Array<{
      id: string;
      packet_code: string;
      batch_id: string;
      batch_name: string;
      estimated_homes: number;
      start_address: string;
      start_longitude: number | null;
      start_latitude: number | null;
      packet_kind: 'street' | 'apartment';
      import_generation: number;
      import_complex_id: string | null;
    }>;
    const segmentRows = database.prepare(
      `SELECT s.import_segment_id AS id, s.street_name, s.road_class,
        s.geometry_geojson, s.estimated_homes
      FROM packet_segments ps
      JOIN street_segments s ON s.id = ps.street_segment_id
      WHERE ps.church_id = ? AND ps.packet_id = ?
      ORDER BY ps.sequence_number`,
    );
    const packets = rows.map((row): DownloadPacket => {
      if (row.start_longitude === null || row.start_latitude === null) {
        throw new Error('Packet starting point missing');
      }
      return {
        kind: row.packet_kind,
        apartmentId: row.import_complex_id,
        id: row.id,
        code: row.packet_code,
        batchId: row.batch_id,
        batchName: row.batch_name,
        importGeneration: row.import_generation,
        estimatedHomes: row.estimated_homes,
        start: {
          address: row.start_address,
          position: [row.start_longitude, row.start_latitude],
        },
        segments: (
          segmentRows.all(workspaceChurchId(), row.id) as Array<{
            id: string;
            street_name: string;
            road_class: string;
            geometry_geojson: string;
            estimated_homes: number;
          }>
        ).map((segment) => ({
          id: segment.id,
          streetName: segment.street_name,
          roadClass: segment.road_class,
          geometry: parseGeometry<LineString>(segment.geometry_geojson),
          estimatedHomes: segment.estimated_homes,
        })),
      };
    });
    if (packets.length === 0) throw new Error('No packets available');
    const networkRows = database.prepare(
      `SELECT import_segment_id, street_name, road_class, geometry_geojson
      FROM street_segments
      WHERE church_id = ? AND territory_id = ? AND import_generation = ?
      ORDER BY import_segment_id`,
    );
    const buildingRows = database.prepare(
      `SELECT source, source_feature_id, geometry_geojson, overture_release,
        fema_address_source_id, fema_distance_meters, fema_occupancy, fema_outbuilding,
        fema_source, fema_product_date, fema_image_date
      FROM map_buildings
      WHERE church_id = ? AND territory_id = ? AND import_generation = ?
      ORDER BY source, source_feature_id`,
    );
    const houseNumberRows = database.prepare(
      `SELECT a.house_number, a.street, a.longitude, a.latitude
      FROM segment_addresses a
      JOIN street_segments s ON s.id = a.street_segment_id
      WHERE s.church_id = ? AND s.territory_id = ? AND s.import_generation = ?
        AND a.house_number IS NOT NULL AND length(trim(a.house_number)) > 0
      ORDER BY a.id`,
    );
    const mapGenerations = [...new Set(packets.map(({ importGeneration }) => importGeneration))]
      .sort((first, second) => first - second)
      .map((importGeneration) => {
        const rawBuildings = buildingRows.all(
          workspaceChurchId(),
          workspaceTerritoryId(),
          importGeneration,
        ) as Array<{
          source: 'overture' | 'fema';
          source_feature_id: string;
          geometry_geojson: string;
          overture_release: string;
          fema_address_source_id: string | null;
          fema_distance_meters: number | null;
          fema_occupancy: string | null;
          fema_outbuilding: number | null;
          fema_source: string | null;
          fema_product_date: string | null;
          fema_image_date: string | null;
        }>;
        const storedBuildings = rawBuildings.map((building) => ({
          source: building.source,
          sourceId: building.source_feature_id,
          geometry: parseGeometry<
            | Polygon
            | {
                type: 'MultiPolygon';
                coordinates: Position[][][];
              }
          >(building.geometry_geojson),
          fema:
            building.source === 'fema'
              ? {
                  addressSourceId: building.fema_address_source_id as string,
                  distanceMeters: building.fema_distance_meters as number,
                  occupancy: 'Single Family Dwelling' as const,
                  outbuilding: false as const,
                  source: building.fema_source,
                  productDate: building.fema_product_date,
                  imageDate: building.fema_image_date,
                }
              : null,
        }));
        const overtureRelease = rawBuildings[0]?.overture_release ?? OVERTURE_RELEASE;
        const buildings = storedBuildings;
        const houseNumbers = (
          houseNumberRows.all(
            workspaceChurchId(),
            workspaceTerritoryId(),
            importGeneration,
          ) as Array<{
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
          importGeneration,
          overtureRelease,
          networkSegments: (
            networkRows.all(
              workspaceChurchId(),
              workspaceTerritoryId(),
              importGeneration,
            ) as Array<{
              import_segment_id: string;
              street_name: string;
              road_class: string;
              geometry_geojson: string;
            }>
          ).map((segment) => ({
            id: segment.import_segment_id,
            streetName: segment.street_name,
            roadClass: segment.road_class,
            geometry: parseGeometry<LineString>(segment.geometry_geojson),
          })),
          buildings,
          houseNumbers,
        };
      });
    return { scope, packets, mapGenerations };
  } finally {
    database.close();
  }
}

type PacketCoverageEventRow = {
  id: string;
  sequence: number;
  completion_group_id: string;
  covered_on: string;
  kind: 'completed' | 'correction';
  corrects_event_id: string | null;
  is_void: number;
  street_segment_id: string | null;
  apartment_complex_id: string | null;
};

function packetCoverageHistory(database: DatabaseSync, packetId: string): PacketCoverageHistory[] {
  const rows = database
    .prepare(
      `SELECT id, rowid AS sequence, completion_group_id, covered_on, kind,
        corrects_event_id, is_void, street_segment_id, apartment_complex_id
      FROM coverage_events
      WHERE packet_id = ?
      ORDER BY rowid`,
    )
    .all(packetId) as PacketCoverageEventRow[];
  const roots = new Map<
    string,
    { groupId: string; originalCoveredOn: string; effectiveCoveredOn: string | null }
  >();
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind === 'completed') {
      roots.set(row.id, {
        groupId: row.completion_group_id,
        originalCoveredOn: row.covered_on,
        effectiveCoveredOn: row.covered_on,
      });
      const groupRoots = groups.get(row.completion_group_id) ?? [];
      groupRoots.push(row.id);
      groups.set(row.completion_group_id, groupRoots);
      continue;
    }
    const root = row.corrects_event_id ? roots.get(row.corrects_event_id) : undefined;
    if (!root) throw new Error('Invalid packet coverage history');
    root.effectiveCoveredOn = row.is_void === 1 ? null : row.covered_on;
  }
  return [...groups].map(([completionGroupId, rootIds]) => {
    const groupRoots = rootIds.map(
      (id) => roots.get(id) as NonNullable<ReturnType<typeof roots.get>>,
    );
    const originals = new Set(groupRoots.map(({ originalCoveredOn }) => originalCoveredOn));
    const effective = new Set(groupRoots.map(({ effectiveCoveredOn }) => effectiveCoveredOn));
    if (originals.size !== 1 || effective.size !== 1) {
      throw new Error('Invalid packet coverage history');
    }
    return {
      completionGroupId,
      originalCoveredOn: groupRoots[0].originalCoveredOn,
      effectiveCoveredOn: groupRoots[0].effectiveCoveredOn,
    };
  });
}

export function getReconciliationWorkspace(filename?: string): ReconciliationWorkspace {
  const database = openWorkspaceDatabase(filename);
  try {
    const batchRows = database
      .prepare(
        `SELECT id, name, status, finalized_at
        FROM batches
        WHERE church_id = ? AND finalized_at IS NOT NULL
        ORDER BY finalized_at DESC, id DESC`,
      )
      .all(workspaceChurchId()) as Array<{
      id: string;
      name: string;
      status: ReconciliationBatch['status'];
      finalized_at: string | null;
    }>;
    const packetRows = database.prepare(
      `SELECT id, packet_code, estimated_homes, start_address, start_longitude, start_latitude,
        packet_kind, status
      FROM packets
      WHERE church_id = ? AND batch_id = ?
      ORDER BY sequence_number, id`,
    );
    const segmentRows = database.prepare(
      `SELECT s.import_segment_id, s.geometry_geojson, s.estimated_homes
      FROM packet_segments ps
      JOIN street_segments s ON s.id = ps.street_segment_id
      WHERE ps.church_id = ? AND ps.packet_id = ?
      ORDER BY ps.sequence_number`,
    );
    const apartmentRow = database.prepare(
      `SELECT a.import_complex_id, a.longitude, a.latitude
      FROM packet_apartment_complexes pa
      JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
      WHERE pa.church_id = ? AND pa.packet_id = ?`,
    );
    const batches = batchRows.map((batch): ReconciliationBatch => {
      const packets = (
        packetRows.all(workspaceChurchId(), batch.id) as Array<{
          id: string;
          packet_code: string;
          estimated_homes: number;
          start_address: string;
          start_longitude: number | null;
          start_latitude: number | null;
          packet_kind: ReconciliationPacket['kind'];
          status: ReconciliationPacket['status'];
        }>
      ).map((packet): ReconciliationPacket => {
        const history = packetCoverageHistory(database, packet.id);
        const completedOn =
          history.findLast(({ effectiveCoveredOn }) => effectiveCoveredOn !== null)
            ?.effectiveCoveredOn ?? null;
        const apartment = apartmentRow.get(workspaceChurchId(), packet.id) as
          | { import_complex_id: string; longitude: number; latitude: number }
          | undefined;
        const segments = (
          segmentRows.all(workspaceChurchId(), packet.id) as Array<{
            import_segment_id: string;
            geometry_geojson: string;
            estimated_homes: number;
          }>
        ).map((segment) => ({
          id: segment.import_segment_id,
          geometry: parseGeometry<LineString>(segment.geometry_geojson),
          estimatedHomes: segment.estimated_homes,
        }));
        const startPosition: Position | undefined =
          packet.start_longitude !== null && packet.start_latitude !== null
            ? [packet.start_longitude, packet.start_latitude]
            : apartment
              ? [apartment.longitude, apartment.latitude]
              : segments[0]?.geometry.coordinates[0];
        if (!startPosition) throw new Error('Packet starting point missing');
        return {
          id: packet.id,
          code: packet.packet_code,
          kind: packet.packet_kind,
          status: packet.status,
          estimatedTracts: packet.estimated_homes,
          start: {
            address: packet.start_address,
            position: startPosition,
          },
          segments,
          apartment: apartment
            ? {
                id: apartment.import_complex_id,
                position: [apartment.longitude, apartment.latitude],
              }
            : null,
          completedOn,
          history,
        };
      });
      return {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        finalizedAt: batch.finalized_at,
        packets,
        counts: {
          active: packets.filter(({ status }) => status === 'active').length,
          completed: packets.filter(({ status }) => status === 'completed').length,
          cancelled: packets.filter(({ status }) => status === 'cancelled').length,
        },
      };
    });
    return {
      asOf: todayForWorkspace(),
      defaultBatchId: batches.find(({ counts }) => counts.active > 0)?.id ?? batches[0]?.id ?? null,
      batches,
    };
  } finally {
    database.close();
  }
}

function sameIds(first: Iterable<string>, second: Iterable<string>): boolean {
  const a = new Set(first);
  const b = new Set(second);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export function reconcilePacketBatch(
  value: ReconciliationInput,
  options: { filename?: string; now?: Date } = {},
): ReconciliationWorkspace {
  const input = parseReconciliationInput(value);
  const coveredOn = calendarDateInTimeZone(options.now ?? new Date(), workspaceTimeZone());
  const present = new Set(input.presentPacketIds);
  const cancel = new Set(input.cancelPacketIds);
  const keep = new Set(input.presentPacketIds.filter((id) => !cancel.has(id)));
  const missing = input.activePacketIds.filter((id) => !present.has(id));
  const database = openWorkspaceDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const batch = database
      .prepare('SELECT id FROM batches WHERE id = ? AND church_id = ? AND finalized_at IS NOT NULL')
      .get(input.batchId, workspaceChurchId());
    if (!batch) throw new Error('Batch not found');
    const packetRows = database
      .prepare(
        `SELECT id, status, packet_kind
        FROM packets
        WHERE batch_id = ? AND church_id = ?`,
      )
      .all(input.batchId, workspaceChurchId()) as Array<{
      id: string;
      status: ReconciliationPacket['status'];
      packet_kind: ReconciliationPacket['kind'];
    }>;
    const byId = new Map(packetRows.map((packet) => [packet.id, packet]));
    const currentActive = packetRows
      .filter(({ status }) => status === 'active')
      .map(({ id }) => id);
    if (!sameIds(currentActive, input.activePacketIds)) {
      const replay =
        input.activePacketIds.every((id) => {
          const status = byId.get(id)?.status;
          return cancel.has(id)
            ? status === 'cancelled'
            : keep.has(id)
              ? status === 'active'
              : status === 'completed';
        }) && sameIds(currentActive, keep);
      if (!replay) throw new ReconciliationConflictError('Reconciliation changed');
      database.exec('ROLLBACK');
      return getReconciliationWorkspace(options.filename);
    }

    const insertStreetEvent = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind)
      VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
    );
    const insertApartmentEvent = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, apartment_complex_id, packet_id, completion_group_id, covered_on, kind)
      VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
    );
    const streetTargets = database.prepare(
      `SELECT street_segment_id FROM packet_segments
      WHERE church_id = ? AND packet_id = ?
      ORDER BY sequence_number`,
    );
    const apartmentTarget = database.prepare(
      `SELECT apartment_complex_id FROM packet_apartment_complexes
      WHERE church_id = ? AND packet_id = ?`,
    );
    const completePacket = database.prepare(
      `UPDATE packets SET status = 'completed'
      WHERE id = ? AND church_id = ? AND status = 'active'`,
    );
    for (const packetId of missing) {
      const packet = byId.get(packetId);
      if (!packet) throw new ReconciliationConflictError('Reconciliation changed');
      const groupId = randomUUID();
      if (packet.packet_kind === 'apartment') {
        const target = apartmentTarget.get(workspaceChurchId(), packetId) as
          | { apartment_complex_id: string }
          | undefined;
        if (!target) throw new Error('Apartment packet target missing');
        insertApartmentEvent.run(
          randomUUID(),
          workspaceChurchId(),
          target.apartment_complex_id,
          packetId,
          groupId,
          coveredOn,
        );
      } else {
        const targets = streetTargets.all(workspaceChurchId(), packetId) as Array<{
          street_segment_id: string;
        }>;
        if (targets.length === 0) throw new Error('Street packet targets missing');
        for (const target of targets) {
          insertStreetEvent.run(
            randomUUID(),
            workspaceChurchId(),
            target.street_segment_id,
            packetId,
            groupId,
            coveredOn,
          );
        }
      }
      if (completePacket.run(packetId, workspaceChurchId()).changes !== 1) {
        throw new ReconciliationConflictError('Reconciliation changed');
      }
    }
    const cancelPacket = database.prepare(
      `UPDATE packets SET status = 'cancelled'
      WHERE id = ? AND church_id = ? AND status = 'active'`,
    );
    for (const packetId of cancel) {
      if (cancelPacket.run(packetId, workspaceChurchId()).changes !== 1) {
        throw new ReconciliationConflictError('Reconciliation changed');
      }
    }
    const counts = database
      .prepare(
        `SELECT
          SUM(status = 'active') AS active,
          SUM(status = 'completed') AS completed
        FROM packets
        WHERE batch_id = ? AND church_id = ?`,
      )
      .get(input.batchId, workspaceChurchId()) as { active: number; completed: number };
    const status =
      counts.active > 0 ? 'finalized' : counts.completed > 0 ? 'reconciled' : 'cancelled';
    database
      .prepare('UPDATE batches SET status = ? WHERE id = ? AND church_id = ?')
      .run(status, input.batchId, workspaceChurchId());
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getReconciliationWorkspace(options.filename);
}

function effectivePacketRoots(
  database: DatabaseSync,
  packetId: string,
  groupId: string,
): Array<PacketCoverageEventRow & { effectiveCoveredOn: string | null }> {
  const rows = database
    .prepare(
      `SELECT id, rowid AS sequence, completion_group_id, covered_on, kind,
        corrects_event_id, is_void, street_segment_id, apartment_complex_id
      FROM coverage_events
      WHERE packet_id = ? AND completion_group_id = ?
      ORDER BY rowid`,
    )
    .all(packetId, groupId) as PacketCoverageEventRow[];
  const roots = new Map<string, PacketCoverageEventRow & { effectiveCoveredOn: string | null }>();
  for (const row of rows) {
    if (row.kind === 'completed') {
      roots.set(row.id, { ...row, effectiveCoveredOn: row.covered_on });
      continue;
    }
    const root = row.corrects_event_id ? roots.get(row.corrects_event_id) : undefined;
    if (!root) throw new Error('Invalid packet coverage history');
    root.effectiveCoveredOn = row.is_void === 1 ? null : row.covered_on;
  }
  return [...roots.values()];
}

export function correctPacketCompletion(
  value: PacketCompletionCorrectionInput,
  options: { filename?: string; now?: Date } = {},
): ReconciliationWorkspace {
  const asOf = calendarDateInTimeZone(options.now ?? new Date(), workspaceTimeZone());
  const input = parsePacketCompletionCorrection(value, asOf);
  const database = openWorkspaceDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const packet = database
      .prepare(
        `SELECT id, batch_id, status
        FROM packets
        WHERE id = ? AND church_id = ?`,
      )
      .get(input.packetId, workspaceChurchId()) as
      | { id: string; batch_id: string; status: ReconciliationPacket['status'] }
      | undefined;
    if (!packet) throw new Error('Packet not found');
    if (packet.status !== 'completed') throw new Error('Packet is not completed');
    const history = packetCoverageHistory(database, packet.id);
    const current = history.findLast(({ effectiveCoveredOn }) => effectiveCoveredOn !== null);
    if (!current) throw new Error('Packet completion not found');
    const roots = effectivePacketRoots(database, packet.id, current.completionGroupId);
    if (roots.length === 0 || roots.some(({ effectiveCoveredOn }) => effectiveCoveredOn === null)) {
      throw new Error('Packet completion not found');
    }

    if (input.coveredOn === null) {
      const streetConflict = database
        .prepare(
          `SELECT DISTINCT p.packet_code
          FROM packet_segments original
          JOIN packet_segments newer ON newer.street_segment_id = original.street_segment_id
          JOIN packets p ON p.id = newer.packet_id AND p.church_id = newer.church_id
          WHERE original.packet_id = ? AND original.church_id = ?
            AND newer.packet_id != original.packet_id AND p.status = 'active'
          ORDER BY p.packet_code`,
        )
        .all(packet.id, workspaceChurchId()) as Array<{ packet_code: string }>;
      const apartmentConflict = database
        .prepare(
          `SELECT DISTINCT p.packet_code
          FROM packet_apartment_complexes original
          JOIN packet_apartment_complexes newer
            ON newer.apartment_complex_id = original.apartment_complex_id
          JOIN packets p ON p.id = newer.packet_id AND p.church_id = newer.church_id
          WHERE original.packet_id = ? AND original.church_id = ?
            AND newer.packet_id != original.packet_id AND p.status = 'active'
          ORDER BY p.packet_code`,
        )
        .all(packet.id, workspaceChurchId()) as Array<{ packet_code: string }>;
      const conflicts = [...streetConflict, ...apartmentConflict].map(
        ({ packet_code }) => packet_code,
      );
      if (conflicts.length > 0) {
        throw new ReconciliationConflictError(
          `Cannot undo while ${[...new Set(conflicts)].join(', ')} reserves this outreach`,
        );
      }
    }

    const insertCorrection = database.prepare(
      `INSERT INTO coverage_events
        (id, church_id, street_segment_id, apartment_complex_id, packet_id,
          completion_group_id, covered_on, kind, corrects_event_id, is_void)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'correction', ?, ?)`,
    );
    for (const root of roots) {
      insertCorrection.run(
        randomUUID(),
        workspaceChurchId(),
        root.street_segment_id,
        root.apartment_complex_id,
        packet.id,
        root.completion_group_id,
        input.coveredOn ?? root.effectiveCoveredOn,
        root.id,
        input.coveredOn === null ? 1 : 0,
      );
    }
    if (input.coveredOn === null) {
      database
        .prepare("UPDATE packets SET status = 'active' WHERE id = ? AND church_id = ?")
        .run(packet.id, workspaceChurchId());
      database
        .prepare("UPDATE batches SET status = 'finalized' WHERE id = ? AND church_id = ?")
        .run(packet.batch_id, workspaceChurchId());
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getReconciliationWorkspace(options.filename);
}

export function saveCoverageThresholds(value: CoverageThresholds, filename?: string): void {
  const thresholds = parseCoverageThresholds(value);
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database
      .prepare(
        `UPDATE territories
        SET coverage_yellow_after_days = ?, coverage_orange_after_days = ?,
          coverage_red_after_days = ?
        WHERE id = ? AND church_id = ?`,
      )
      .run(
        thresholds.yellowAfterDays,
        thresholds.orangeAfterDays,
        thresholds.redAfterDays,
        workspaceTerritoryId(),
        workspaceChurchId(),
      );
    if (result.changes !== 1) throw new Error('Territory not found');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function recordCoverageCompletion(
  segmentId: string,
  coveredOn: string,
  filename?: string,
): string {
  validateCoverageDate(coveredOn, todayForWorkspace());
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const segment = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get(workspaceChurchId(), workspaceTerritoryId(), segmentId) as { id: string } | undefined;
    if (!segment) throw new Error('Street segment not found');
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
        VALUES (?, ?, ?, ?, 'completed')`,
      )
      .run(id, workspaceChurchId(), segment.id, coveredOn);
    database.exec('COMMIT');
    return id;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function appendCoverageCorrection(
  eventId: string,
  coveredOn: string | null,
  filename?: string,
): void {
  if (coveredOn !== null) validateCoverageDate(coveredOn, todayForWorkspace());
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const root = database
      .prepare(
        `SELECT id, church_id, street_segment_id, covered_on, packet_id
        FROM coverage_events
        WHERE id = ? AND church_id = ? AND kind = 'completed'`,
      )
      .get(eventId, workspaceChurchId()) as
      | {
          id: string;
          church_id: string;
          street_segment_id: string;
          covered_on: string;
          packet_id: string | null;
        }
      | undefined;
    if (!root) throw new Error('Coverage event not found');
    if (root.packet_id) {
      throw new Error('Packet-managed coverage must be corrected in Reconcile packets');
    }
    const latest = database
      .prepare(
        `SELECT covered_on, is_void FROM coverage_events
        WHERE corrects_event_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(eventId) as { covered_on: string; is_void: number } | undefined;
    if (coveredOn === null && latest?.is_void === 1)
      throw new Error('Coverage event is already void');
    const effectiveDate = latest?.is_void === 0 ? latest.covered_on : root.covered_on;
    const correctionDate = coveredOn ?? effectiveDate;
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
        VALUES (?, ?, ?, ?, 'correction', ?, ?)`,
      )
      .run(
        randomUUID(),
        root.church_id,
        root.street_segment_id,
        correctionDate,
        eventId,
        coveredOn === null ? 1 : 0,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
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
      .get(workspaceChurchId()) as SummaryRow;
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
    const apartmentComplexes = (
      database
        .prepare(
          `SELECT import_complex_id, source_id, address, longitude, latitude, estimated_tracts,
            apartment_building, distinct_units, review_status
          FROM apartment_complexes
          WHERE territory_id = ? AND church_id = ? AND is_current = 1
          ORDER BY address, import_complex_id`,
        )
        .all(workspaceTerritoryId(), workspaceChurchId()) as ApartmentRow[]
    ).map(
      (row): ApartmentComplex => ({
        id: row.import_complex_id,
        sourceId: row.source_id,
        address: row.address,
        position: [row.longitude, row.latitude],
        estimatedTracts: row.estimated_tracts,
        evidence: {
          apartmentBuilding: row.apartment_building === 1,
          distinctUnits: row.distinct_units,
        },
        reviewStatus: row.review_status,
        withinBoundary: pointInsideTerritoryBoundary(
          [row.longitude, row.latitude],
          center,
          radiusMiles,
          boundaryShape,
        ),
      }),
    );

    return {
      id: territory.id,
      churchName: territory.church_name,
      name: territory.name,
      originAddress: territory.origin_address,
      center,
      radiusMiles,
      boundaryShape,
      import: imported,
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

type SaveTerritoryOptions = {
  filename?: string;
  imported?: ImportedTerritoryInput;
};

export function saveTerritoryDraft(
  draft: TerritoryDraftInput,
  options: SaveTerritoryOptions = {},
): void {
  const database = openWorkspaceDatabase(options.filename);
  const activatedSegmentIds = new Set(draft.activatedSegmentIds);
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
        workspaceTerritoryId(),
        workspaceChurchId(),
      );
    if (result.changes !== 1) {
      throw new Error('Territory not found');
    }

    if (options.imported) {
      const apartmentStatuses = new Map(
        (
          database
            .prepare(
              `SELECT import_complex_id, review_status
              FROM apartment_complexes
              WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
            )
            .all(workspaceTerritoryId(), workspaceChurchId()) as Array<{
            import_complex_id: string;
            review_status: ApartmentComplex['reviewStatus'];
          }>
        ).map((row) => [row.import_complex_id, row.review_status]),
      );
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
            import_generation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const apartment of options.imported.apartmentComplexes) {
        insertApartment.run(
          `${apartment.id}@${generation}`,
          workspaceChurchId(),
          workspaceTerritoryId(),
          apartment.id,
          apartment.sourceId,
          apartment.address,
          apartment.position[0],
          apartment.position[1],
          apartment.estimatedTracts,
          apartment.evidence.apartmentBuilding ? 1 : 0,
          apartment.evidence.distinctUnits,
          apartmentStatuses.get(apartment.id) ?? 'needs_review',
          generation,
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
    const updateApartment = database.prepare(
      `UPDATE apartment_complexes
      SET review_status = ?
      WHERE territory_id = ? AND church_id = ? AND is_current = 1 AND import_complex_id = ?
        AND (? != 'ready' OR address IS NOT NULL)`,
    );
    const importedApartmentIds = options.imported
      ? new Set(options.imported.apartmentComplexes.map(({ id }) => id))
      : null;
    for (const apartment of draft.apartmentStatuses ?? []) {
      if (importedApartmentIds && !importedApartmentIds.has(apartment.id)) continue;
      if (
        updateApartment.run(
          apartment.reviewStatus,
          workspaceTerritoryId(),
          workspaceChurchId(),
          apartment.id,
          apartment.reviewStatus,
        ).changes !== 1
      ) {
        throw new Error('Apartment complex not found or not ready for outreach');
      }
    }
    database
      .prepare(
        `UPDATE churches
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      )
      .run(workspaceChurchId());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
