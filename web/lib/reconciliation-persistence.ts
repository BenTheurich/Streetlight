import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { calendarDateInTimeZone } from './coverage.ts';
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
import { openSqliteDatabase } from './sqlite-persistence.ts';
import type { LineString, Position } from './territory-geometry.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTimeZone(): string {
  return requireWorkspaceScope().timeZone;
}

function todayForWorkspace(): string {
  return calendarDateInTimeZone(new Date(), workspaceTimeZone());
}

function parseGeometry<T extends LineString>(json: string): T {
  return JSON.parse(json) as T;
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
  const database = openSqliteDatabase(filename);
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
  const database = openSqliteDatabase(options.filename);
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
  const database = openSqliteDatabase(options.filename);
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
