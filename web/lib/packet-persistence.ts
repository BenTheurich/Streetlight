import { randomUUID } from 'node:crypto';
import { calendarDateInTimeZone } from './coverage.ts';
import { getCoverageWorkspace } from './coverage-persistence.ts';
import type { ImportedMapBuilding } from './overture-import.ts';
import {
  type DownloadPacket,
  type FinalizedBatch,
  type PacketDownloadSelection,
  type PacketDownloadTarget,
  type PacketFinalizationInput,
  PacketProposalConflictError,
  packetProposalFingerprint,
} from './packet-finalization.ts';
import {
  type ApartmentPacketCandidate,
  generatePacketProposals,
  type PacketAddress,
  type PacketGenerationWorkspace,
  type PacketSelectionSegment,
} from './packet-selection.ts';
import { APARTMENTS_ENABLED, applyMvpCapabilities } from './product-capabilities.ts';
import { openSqliteDatabase } from './sqlite-persistence.ts';
import type { LineString, Polygon, Position } from './territory-geometry.ts';
import { OVERTURE_RELEASE } from './territory-import.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

type FinalizePacketBatchOptions = {
  filename?: string;
  now?: Date;
  asOf?: string;
  apartmentsEnabled?: boolean;
};

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTerritoryId(): string {
  return requireWorkspaceScope().territoryId;
}

function workspaceTimeZone(): string {
  return requireWorkspaceScope().timeZone;
}

function todayForWorkspace(): string {
  return calendarDateInTimeZone(new Date(), workspaceTimeZone());
}

function parseGeometry<T extends LineString | ImportedMapBuilding['geometry']>(json: string): T {
  return JSON.parse(json) as T;
}

export function getPacketGenerationWorkspace(
  filename?: string,
  asOf = todayForWorkspace(),
): PacketGenerationWorkspace {
  const coverage = getCoverageWorkspace(filename, asOf);
  const database = openSqliteDatabase(filename);
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
          apartment.withinBoundary &&
          apartment.packetReady &&
          apartment.includedInPackets &&
          apartment.address &&
          apartment.tractCount !== null &&
          apartment.accessStatus !== 'unknown',
      )
      .map(
        (apartment): ApartmentPacketCandidate => ({
          id: apartment.id,
          address: apartment.address as string,
          position: apartment.position,
          tractCount: apartment.tractCount as number,
          accessStatus: apartment.accessStatus as 'open' | 'restricted',
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
  const database = openSqliteDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const generatedProposals = generatePacketProposals({
      ...applyMvpCapabilities(
        getPacketGenerationWorkspace(options.filename, options.asOf ?? todayForWorkspace()),
        options.apartmentsEnabled ?? APARTMENTS_ENABLED,
      ),
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
          sequence_number, start_longitude, start_latitude, packet_kind, apartment_access_status)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
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
        proposal.accessStatus ?? null,
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
  target: PacketDownloadTarget,
  filename?: string,
): PacketDownloadSelection {
  const scope = typeof target === 'string' ? target : 'batch';
  const database = openSqliteDatabase(filename);
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
          p.apartment_access_status,
          b.import_generation,
          a.import_complex_id
        FROM packets p
        JOIN batches b ON b.id = p.batch_id AND b.church_id = p.church_id
        LEFT JOIN packet_apartment_complexes pa ON pa.packet_id = p.id AND pa.church_id = p.church_id
        LEFT JOIN apartment_complexes a ON a.id = pa.apartment_complex_id
        WHERE p.church_id = ?
          AND b.finalized_at IS NOT NULL
          AND (${scope === 'active' ? "p.status = 'active'" : 'p.batch_id = ?'})
        ORDER BY b.finalized_at, b.id, p.sequence_number, p.id`,
      )
      .all(
        workspaceChurchId(),
        ...(typeof target === 'object'
          ? [target.batchId]
          : scope === 'newest'
            ? [newest?.id ?? '']
            : []),
      ) as Array<{
      id: string;
      packet_code: string;
      batch_id: string;
      batch_name: string;
      estimated_homes: number;
      start_address: string;
      start_longitude: number | null;
      start_latitude: number | null;
      packet_kind: 'street' | 'apartment';
      apartment_access_status: 'open' | 'restricted' | null;
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
        accessStatus: row.apartment_access_status,
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
