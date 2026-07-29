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
import type { ImportedTerritoryInput } from './overture-import.ts';
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
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  type LineString,
  lineInsideTerritoryBoundary,
  lineIntersectsPolygon,
  type Polygon,
  type Position,
  pointInsideTerritoryBoundary,
  territoryBoundary,
} from './territory-geometry.ts';
import type { TerritoryImportMetadata } from './territory-import.ts';

const PILOT_CHURCH_ID = 'church-temecula-pilot';
const PILOT_TERRITORY_ID = 'territory-temecula-pilot';
// ponytail: Single-pilot timezone; store this per church when multi-church support arrives.
const PILOT_TIME_ZONE = 'America/Los_Angeles';

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
  exclusions: ExclusionArea[];
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
  'id' | 'streetName' | 'geometry' | 'estimatedHomes' | 'eligible' | 'excludedReason'
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

function parseGeometry<T extends LineString | Polygon>(json: string): T {
  return JSON.parse(json) as T;
}

function todayForPilot(): string {
  return calendarDateInTimeZone(new Date(), PILOT_TIME_ZONE);
}

export function getCoverageWorkspace(filename?: string, asOf = todayForPilot()): CoverageWorkspace {
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
      .get(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as
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
      .all(PILOT_CHURCH_ID, PILOT_TERRITORY_ID)
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
      .all(PILOT_CHURCH_ID, PILOT_TERRITORY_ID)
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
        .get(PILOT_CHURCH_ID, 'active') as { count: number }
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
      .get(PILOT_CHURCH_ID) as
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

export function getPacketGenerationWorkspace(
  filename?: string,
  asOf = todayForPilot(),
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
      .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Array<{
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
          .all(PILOT_CHURCH_ID, PILOT_TERRITORY_ID) as Array<{ import_segment_id: string }>
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
          .all(PILOT_CHURCH_ID, PILOT_TERRITORY_ID) as Array<{ import_complex_id: string }>
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
    timeZone: PILOT_TIME_ZONE,
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
  const date = calendarDateInTimeZone(now, PILOT_TIME_ZONE).replaceAll('-', '');
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
    const proposals = generatePacketProposals({
      ...getPacketGenerationWorkspace(options.filename, options.asOf ?? todayForPilot()),
      requests: input.requests,
    }).proposals;
    if (
      proposals.length === 0 ||
      packetProposalFingerprint(proposals) !== input.proposalFingerprint
    ) {
      throw new PacketProposalConflictError('Packet proposals changed');
    }

    const batchId = randomUUID();
    const name = customName ?? automaticBatchName(now);
    database
      .prepare(
        `INSERT INTO batches (id, church_id, name, status, finalized_at)
        VALUES (?, ?, ?, 'finalized', ?)`,
      )
      .run(batchId, PILOT_CHURCH_ID, name, finalizedAt);
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
        PILOT_CHURCH_ID,
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
        const row = segmentRow.get(PILOT_CHURCH_ID, PILOT_TERRITORY_ID, segment.id) as
          | { id: string }
          | undefined;
        if (!row) throw new PacketProposalConflictError('Packet proposals changed');
        insertSegment.run(PILOT_CHURCH_ID, id, row.id, segmentSequence);
      });
      if (proposal.kind === 'apartment') {
        if (!proposal.apartmentId) {
          throw new PacketProposalConflictError('Packet proposals changed');
        }
        const row = apartmentRow.get(PILOT_CHURCH_ID, PILOT_TERRITORY_ID, proposal.apartmentId) as
          | { id: string }
          | undefined;
        if (!row) throw new PacketProposalConflictError('Packet proposals changed');
        insertApartment.run(PILOT_CHURCH_ID, id, row.id);
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
            .get(PILOT_CHURCH_ID) as { id: string } | undefined)
        : undefined;
    const rows = database
      .prepare(
        `SELECT p.id, p.packet_code, p.batch_id, b.name AS batch_name, p.estimated_homes,
          p.start_address, p.start_longitude, p.start_latitude, p.packet_kind,
          a.import_complex_id
        FROM packets p
        JOIN batches b ON b.id = p.batch_id AND b.church_id = p.church_id
        LEFT JOIN packet_apartment_complexes pa ON pa.packet_id = p.id AND pa.church_id = p.church_id
        LEFT JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
        WHERE p.church_id = ?
          AND (${scope === 'newest' ? 'p.batch_id = ?' : "p.status = 'active'"})
        ORDER BY b.finalized_at, b.id, p.sequence_number, p.id`,
      )
      .all(PILOT_CHURCH_ID, ...(scope === 'newest' ? [newest?.id ?? ''] : [])) as Array<{
      id: string;
      packet_code: string;
      batch_id: string;
      batch_name: string;
      estimated_homes: number;
      start_address: string;
      start_longitude: number | null;
      start_latitude: number | null;
      packet_kind: 'street' | 'apartment';
      import_complex_id: string | null;
    }>;
    const segmentRows = database.prepare(
      `SELECT s.import_segment_id AS id, s.geometry_geojson, s.estimated_homes
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
        estimatedHomes: row.estimated_homes,
        start: {
          address: row.start_address,
          position: [row.start_longitude, row.start_latitude],
        },
        segments: (
          segmentRows.all(PILOT_CHURCH_ID, row.id) as Array<{
            id: string;
            geometry_geojson: string;
            estimated_homes: number;
          }>
        ).map((segment) => ({
          id: segment.id,
          geometry: parseGeometry<LineString>(segment.geometry_geojson),
          estimatedHomes: segment.estimated_homes,
        })),
      };
    });
    if (packets.length === 0) throw new Error('No packets available');
    return { scope, packets };
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

function packetCoverageHistory(
  database: DatabaseSync,
  packetId: string,
): PacketCoverageHistory[] {
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
    const groupRoots = rootIds.map((id) => roots.get(id) as NonNullable<ReturnType<typeof roots.get>>);
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
      .all(PILOT_CHURCH_ID) as Array<{
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
        packetRows.all(PILOT_CHURCH_ID, batch.id) as Array<{
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
        if (packet.start_longitude === null || packet.start_latitude === null) {
          throw new Error('Packet starting point missing');
        }
        const history = packetCoverageHistory(database, packet.id);
        const completedOn =
          history.findLast(({ effectiveCoveredOn }) => effectiveCoveredOn !== null)
            ?.effectiveCoveredOn ?? null;
        const apartment = apartmentRow.get(PILOT_CHURCH_ID, packet.id) as
          | { import_complex_id: string; longitude: number; latitude: number }
          | undefined;
        return {
          id: packet.id,
          code: packet.packet_code,
          kind: packet.packet_kind,
          status: packet.status,
          estimatedTracts: packet.estimated_homes,
          start: {
            address: packet.start_address,
            position: [packet.start_longitude, packet.start_latitude],
          },
          segments: (
            segmentRows.all(PILOT_CHURCH_ID, packet.id) as Array<{
              import_segment_id: string;
              geometry_geojson: string;
              estimated_homes: number;
            }>
          ).map((segment) => ({
            id: segment.import_segment_id,
            geometry: parseGeometry<LineString>(segment.geometry_geojson),
            estimatedHomes: segment.estimated_homes,
          })),
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
      asOf: todayForPilot(),
      defaultBatchId:
        batches.find(({ counts }) => counts.active > 0)?.id ?? batches[0]?.id ?? null,
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
  const coveredOn = calendarDateInTimeZone(options.now ?? new Date(), PILOT_TIME_ZONE);
  const present = new Set(input.presentPacketIds);
  const cancel = new Set(input.cancelPacketIds);
  const keep = new Set(input.presentPacketIds.filter((id) => !cancel.has(id)));
  const missing = input.activePacketIds.filter((id) => !present.has(id));
  const database = openWorkspaceDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const batch = database
      .prepare('SELECT id FROM batches WHERE id = ? AND church_id = ? AND finalized_at IS NOT NULL')
      .get(input.batchId, PILOT_CHURCH_ID);
    if (!batch) throw new Error('Batch not found');
    const packetRows = database
      .prepare(
        `SELECT id, status, packet_kind
        FROM packets
        WHERE batch_id = ? AND church_id = ?`,
      )
      .all(input.batchId, PILOT_CHURCH_ID) as Array<{
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
        const target = apartmentTarget.get(PILOT_CHURCH_ID, packetId) as
          | { apartment_complex_id: string }
          | undefined;
        if (!target) throw new Error('Apartment packet target missing');
        insertApartmentEvent.run(
          randomUUID(),
          PILOT_CHURCH_ID,
          target.apartment_complex_id,
          packetId,
          groupId,
          coveredOn,
        );
      } else {
        const targets = streetTargets.all(PILOT_CHURCH_ID, packetId) as Array<{
          street_segment_id: string;
        }>;
        if (targets.length === 0) throw new Error('Street packet targets missing');
        for (const target of targets) {
          insertStreetEvent.run(
            randomUUID(),
            PILOT_CHURCH_ID,
            target.street_segment_id,
            packetId,
            groupId,
            coveredOn,
          );
        }
      }
      if (completePacket.run(packetId, PILOT_CHURCH_ID).changes !== 1) {
        throw new ReconciliationConflictError('Reconciliation changed');
      }
    }
    const cancelPacket = database.prepare(
      `UPDATE packets SET status = 'cancelled'
      WHERE id = ? AND church_id = ? AND status = 'active'`,
    );
    for (const packetId of cancel) {
      if (cancelPacket.run(packetId, PILOT_CHURCH_ID).changes !== 1) {
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
      .get(input.batchId, PILOT_CHURCH_ID) as { active: number; completed: number };
    const status = counts.active > 0 ? 'finalized' : counts.completed > 0 ? 'reconciled' : 'cancelled';
    database
      .prepare('UPDATE batches SET status = ? WHERE id = ? AND church_id = ?')
      .run(status, input.batchId, PILOT_CHURCH_ID);
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
  const asOf = calendarDateInTimeZone(options.now ?? new Date(), PILOT_TIME_ZONE);
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
      .get(input.packetId, PILOT_CHURCH_ID) as
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
        .all(packet.id, PILOT_CHURCH_ID) as Array<{ packet_code: string }>;
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
        .all(packet.id, PILOT_CHURCH_ID) as Array<{ packet_code: string }>;
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
        PILOT_CHURCH_ID,
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
        .run(packet.id, PILOT_CHURCH_ID);
      database
        .prepare("UPDATE batches SET status = 'finalized' WHERE id = ? AND church_id = ?")
        .run(packet.batch_id, PILOT_CHURCH_ID);
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
        PILOT_TERRITORY_ID,
        PILOT_CHURCH_ID,
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
  validateCoverageDate(coveredOn, todayForPilot());
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const segment = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get(PILOT_CHURCH_ID, PILOT_TERRITORY_ID, segmentId) as { id: string } | undefined;
    if (!segment) throw new Error('Street segment not found');
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
        VALUES (?, ?, ?, ?, 'completed')`,
      )
      .run(id, PILOT_CHURCH_ID, segment.id, coveredOn);
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
  if (coveredOn !== null) validateCoverageDate(coveredOn, todayForPilot());
  const database = openWorkspaceDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const root = database
      .prepare(
        `SELECT id, church_id, street_segment_id, covered_on, packet_id
        FROM coverage_events
        WHERE id = ? AND church_id = ? AND kind = 'completed'`,
      )
      .get(eventId, PILOT_CHURCH_ID) as
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
    const apartmentComplexes = (
      database
        .prepare(
          `SELECT import_complex_id, source_id, address, longitude, latitude, estimated_tracts,
            apartment_building, distinct_units, review_status
          FROM apartment_complexes
          WHERE territory_id = ? AND church_id = ? AND is_current = 1
          ORDER BY address, import_complex_id`,
        )
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as ApartmentRow[]
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
      exclusions,
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
      const apartmentStatuses = new Map(
        (
          database
            .prepare(
              `SELECT import_complex_id, review_status
              FROM apartment_complexes
              WHERE territory_id = ? AND church_id = ? AND is_current = 1`,
            )
            .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Array<{
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
        .all(PILOT_TERRITORY_ID, PILOT_CHURCH_ID) as Array<{
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
      database
        .prepare(
          `UPDATE apartment_complexes
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
          PILOT_CHURCH_ID,
          PILOT_TERRITORY_ID,
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
      for (const segment of manualRows) {
        if (segment.source_segment_id && importedSourceIds.has(segment.source_segment_id)) {
          continue;
        }
        const physicalId = `${segment.import_segment_id}@${generation}`;
        insertSegment.run(
          physicalId,
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
            import_assigned_addresses = ?, import_spatially_assigned_addresses = ?,
            import_inferred_roads = ?, import_unmatched_addresses = ?,
            import_unresolved_clusters = ?, import_total_residential_buildings = ?,
            import_fallback_buildings = ?, import_unmatched_residential_buildings = ?,
            import_populated_unnamed_roads = ?, import_building_address_disagreements = ?,
            import_quality_warnings_json = ?,
            import_normalizer_version = ?, import_generation = ?
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
          PILOT_TERRITORY_ID,
          PILOT_CHURCH_ID,
          apartment.id,
          apartment.reviewStatus,
        ).changes !== 1
      ) {
        throw new Error('Apartment complex not found or not ready for outreach');
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
