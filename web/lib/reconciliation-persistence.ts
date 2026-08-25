import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { calendarDateInTimeZone, validateCoverageDate } from './coverage.ts';
import type {
  PacketCoverageHistory,
  ReconciliationBatch,
  ReconciliationDecision,
  ReconciliationPacket,
  ReconciliationSubmission,
  ReconciliationWorkspace,
} from './reconciliation.ts';
import {
  type CoverageHistory,
  type CoverageHistoryEvent,
  interpretCoverageHistory,
} from './reconciliation-history.ts';
import { openSqliteDatabase } from './sqlite-persistence.ts';
import type { LineString, Position } from './territory-geometry.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

type ReconciliationOptions = { filename?: string; now?: Date };

export type ReconciliationApplyResult =
  | { kind: 'accepted'; workspace: ReconciliationWorkspace }
  | { kind: 'invalid'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'conflict'; message: string };

type CompletionInput = { packetId: string; coveredOn: string | null };

class ReconciliationApplyError extends Error {
  readonly kind: 'not-found' | 'conflict';

  constructor(kind: 'not-found' | 'conflict', message: string) {
    super(message);
    this.kind = kind;
  }
}

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTimeZone(): string {
  return requireWorkspaceScope().timeZone;
}

function todayForWorkspace(now = new Date()): string {
  return calendarDateInTimeZone(now, workspaceTimeZone());
}

function parseGeometry<T extends LineString>(json: string): T {
  return JSON.parse(json) as T;
}

type CoverageEventRow = {
  id: string;
  sequence: number;
  packet_id: string;
  completion_group_id: string;
  covered_on: string;
  kind: 'completed' | 'correction';
  corrects_event_id: string | null;
  is_void: number;
  street_segment_id: string | null;
  apartment_complex_id: string | null;
};

function packetHistory(database: DatabaseSync, asOf: string, packetId?: string): CoverageHistory {
  const rows = database
    .prepare(
      `SELECT id, rowid AS sequence, packet_id, completion_group_id, covered_on, kind,
        corrects_event_id, is_void, street_segment_id, apartment_complex_id
      FROM coverage_events
      WHERE church_id = ? AND packet_id IS NOT NULL
        AND (? IS NULL OR packet_id = ?)
      ORDER BY rowid`,
    )
    .all(workspaceChurchId(), packetId ?? null, packetId ?? null) as CoverageEventRow[];
  const events = rows.map((row): CoverageHistoryEvent => {
    const targetKind = row.street_segment_id ? 'street' : 'apartment';
    const targetId = row.street_segment_id ?? row.apartment_complex_id;
    if (!targetId) throw new Error('Invalid coverage history');
    return {
      id: row.id,
      sequence: row.sequence,
      targetId,
      targetKind,
      packetId: row.packet_id,
      completionGroupId: row.completion_group_id,
      coveredOn: row.covered_on,
      kind: row.kind,
      correctsEventId: row.corrects_event_id,
      isVoid: row.is_void === 1,
    };
  });
  return interpretCoverageHistory(events, asOf);
}

export function readReconciliation(options: ReconciliationOptions = {}): ReconciliationWorkspace {
  const asOf = todayForWorkspace(options.now);
  const database = openSqliteDatabase(options.filename);
  try {
    const history = packetHistory(database, asOf);
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
        const groups = history.packetGroups.get(packet.id) ?? [];
        const packetCoverage: PacketCoverageHistory[] = groups.map((group) => ({
          completionGroupId: group.completionGroupId,
          originalCoveredOn: group.originalCoveredOn,
          effectiveCoveredOn: group.effectiveCoveredOn,
        }));
        const completedOn =
          packetCoverage.findLast(({ effectiveCoveredOn }) => effectiveCoveredOn !== null)
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
          start: { address: packet.start_address, position: startPosition },
          segments,
          apartment: apartment
            ? {
                id: apartment.import_complex_id,
                position: [apartment.longitude, apartment.latitude],
              }
            : null,
          completedOn,
          history: packetCoverage,
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
      asOf,
      defaultBatchId: batches.find(({ counts }) => counts.active > 0)?.id ?? batches[0]?.id ?? null,
      batches,
    };
  } finally {
    database.close();
  }
}

function parseDecisions(value: unknown): ReconciliationDecision[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) return null;
  const decisions: ReconciliationDecision[] = [];
  const packetIds = new Set<string>();
  for (const candidate of value) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(',') !== 'outcome,packetId'
    ) {
      return null;
    }
    const { packetId, outcome } = candidate as Record<string, unknown>;
    if (
      typeof packetId !== 'string' ||
      packetId.length === 0 ||
      packetIds.has(packetId) ||
      (outcome !== 'still-here' && outcome !== 'taken' && outcome !== 'discarded')
    ) {
      return null;
    }
    packetIds.add(packetId);
    decisions.push({ packetId, outcome });
  }
  return decisions;
}

function parseReconciliation(value: unknown): ReconciliationSubmission {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'batchId,decisions'
  ) {
    throw new Error('Invalid reconciliation request');
  }
  const input = value as Record<string, unknown>;
  const decisions = parseDecisions(input.decisions);
  if (typeof input.batchId !== 'string' || input.batchId.length === 0 || !decisions) {
    throw new Error('Invalid reconciliation request');
  }
  return { batchId: input.batchId, decisions };
}

function parseCompletion(value: unknown, asOf: string): CompletionInput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'coveredOn,packetId'
  ) {
    throw new Error('Invalid packet correction request');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.packetId !== 'string' ||
    input.packetId.length === 0 ||
    (input.coveredOn !== null && typeof input.coveredOn !== 'string')
  ) {
    throw new Error('Invalid packet correction request');
  }
  if (typeof input.coveredOn === 'string') validateCoverageDate(input.coveredOn, asOf);
  return { packetId: input.packetId, coveredOn: input.coveredOn as string | null };
}

function sameIds(first: Iterable<string>, second: Iterable<string>): boolean {
  const a = new Set(first);
  const b = new Set(second);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function reconcilePacketBatch(
  input: ReconciliationSubmission,
  options: ReconciliationOptions,
): ReconciliationWorkspace {
  const coveredOn = todayForWorkspace(options.now);
  const outcomes = new Map(input.decisions.map(({ packetId, outcome }) => [packetId, outcome]));
  const keep = input.decisions
    .filter(({ outcome }) => outcome === 'still-here')
    .map(({ packetId }) => packetId);
  const complete = input.decisions
    .filter(({ outcome }) => outcome === 'taken')
    .map(({ packetId }) => packetId);
  const cancel = input.decisions
    .filter(({ outcome }) => outcome === 'discarded')
    .map(({ packetId }) => packetId);
  const database = openSqliteDatabase(options.filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const batch = database
      .prepare('SELECT id FROM batches WHERE id = ? AND church_id = ? AND finalized_at IS NOT NULL')
      .get(input.batchId, workspaceChurchId());
    if (!batch) throw new ReconciliationApplyError('not-found', 'Batch not found');
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
    if (!sameIds(currentActive, outcomes.keys())) {
      const replay =
        input.decisions.every(({ packetId, outcome }) => {
          const status = byId.get(packetId)?.status;
          return outcome === 'discarded'
            ? status === 'cancelled'
            : outcome === 'still-here'
              ? status === 'active'
              : status === 'completed';
        }) && sameIds(currentActive, keep);
      if (!replay) {
        throw new ReconciliationApplyError(
          'conflict',
          'Reconciliation changed. Reload and review the batch again.',
        );
      }
      database.exec('ROLLBACK');
      return readReconciliation(options);
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
    for (const packetId of complete) {
      const packet = byId.get(packetId);
      if (!packet) {
        throw new ReconciliationApplyError(
          'conflict',
          'Reconciliation changed. Reload and review the batch again.',
        );
      }
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
        throw new ReconciliationApplyError(
          'conflict',
          'Reconciliation changed. Reload and review the batch again.',
        );
      }
    }
    const cancelPacket = database.prepare(
      `UPDATE packets SET status = 'cancelled'
      WHERE id = ? AND church_id = ? AND status = 'active'`,
    );
    for (const packetId of cancel) {
      if (cancelPacket.run(packetId, workspaceChurchId()).changes !== 1) {
        throw new ReconciliationApplyError(
          'conflict',
          'Reconciliation changed. Reload and review the batch again.',
        );
      }
    }
    const counts = database
      .prepare(
        `SELECT SUM(status = 'active') AS active, SUM(status = 'completed') AS completed
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
  return readReconciliation(options);
}

function correctPacketCompletion(
  input: CompletionInput,
  options: ReconciliationOptions,
): ReconciliationWorkspace {
  const asOf = todayForWorkspace(options.now);
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
    if (!packet) throw new ReconciliationApplyError('not-found', 'Packet not found');
    if (packet.status !== 'completed') {
      throw new ReconciliationApplyError('conflict', 'Packet is not completed');
    }
    const groups = packetHistory(database, asOf, packet.id).packetGroups.get(packet.id) ?? [];
    const current = groups.findLast(({ effectiveCoveredOn }) => effectiveCoveredOn !== null);
    if (!current || current.roots.length === 0) {
      throw new ReconciliationApplyError('not-found', 'Packet completion not found');
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
        throw new ReconciliationApplyError(
          'conflict',
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
    for (const root of current.roots) {
      if (root.effectiveCoveredOn === null) {
        throw new Error('Invalid coverage history');
      }
      insertCorrection.run(
        randomUUID(),
        workspaceChurchId(),
        root.targetKind === 'street' ? root.targetId : null,
        root.targetKind === 'apartment' ? root.targetId : null,
        packet.id,
        root.completionGroupId,
        input.coveredOn ?? root.effectiveCoveredOn,
        root.eventId,
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
  return readReconciliation(options);
}

export function applyReconciliation(
  operation: 'reconcile' | 'completion',
  payload: unknown,
  options: ReconciliationOptions = {},
): ReconciliationApplyResult {
  const asOf = todayForWorkspace(options.now);
  let input: ReconciliationSubmission | CompletionInput;
  try {
    input =
      operation === 'reconcile' ? parseReconciliation(payload) : parseCompletion(payload, asOf);
  } catch {
    return {
      kind: 'invalid',
      message:
        operation === 'reconcile'
          ? 'Invalid reconciliation request'
          : 'Invalid packet correction request',
    };
  }

  try {
    const workspace =
      operation === 'reconcile'
        ? reconcilePacketBatch(input as ReconciliationSubmission, options)
        : correctPacketCompletion(input as CompletionInput, options);
    return { kind: 'accepted', workspace };
  } catch (error) {
    if (error instanceof ReconciliationApplyError) {
      return { kind: error.kind, message: error.message };
    }
    throw error;
  }
}
