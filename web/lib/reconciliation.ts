import { validateCoverageDate } from './coverage.ts';
import type { PacketProposal } from './packet-selection.ts';
import type { Position } from './territory-geometry.ts';

export type ReconciliationInput = {
  batchId: string;
  activePacketIds: string[];
  presentPacketIds: string[];
  cancelPacketIds: string[];
};

export type ReconciliationOutcome = 'still-here' | 'taken' | 'discarded';

export type PacketCompletionCorrectionInput = {
  packetId: string;
  coveredOn: string | null;
};

export type PacketCoverageHistory = {
  completionGroupId: string;
  originalCoveredOn: string;
  effectiveCoveredOn: string | null;
};

export type ReconciliationPacket = {
  id: string;
  code: string;
  kind: 'street' | 'apartment';
  status: 'active' | 'completed' | 'cancelled';
  estimatedTracts: number;
  start: { address: string; position: Position };
  segments: PacketProposal['segments'];
  apartment: { id: string; position: Position } | null;
  completedOn: string | null;
  history: PacketCoverageHistory[];
};

export type ReconciliationBatch = {
  id: string;
  name: string;
  status: 'draft' | 'finalized' | 'reconciled' | 'cancelled';
  finalizedAt: string | null;
  packets: ReconciliationPacket[];
  counts: { active: number; completed: number; cancelled: number };
};

export type ReconciliationWorkspace = {
  asOf: string;
  defaultBatchId: string | null;
  batches: ReconciliationBatch[];
};

export class ReconciliationConflictError extends Error {}

export function buildReconciliationPreview(
  activePacketIds: string[],
  presentPacketIds: string[],
  cancelPacketIds: string[],
): { complete: string[]; active: string[]; cancel: string[] } {
  const active = new Set(activePacketIds);
  const present = new Set(presentPacketIds);
  const cancel = new Set(cancelPacketIds);
  if (
    presentPacketIds.some((id) => !active.has(id)) ||
    cancelPacketIds.some((id) => !present.has(id))
  ) {
    throw new Error('Invalid reconciliation choices');
  }
  return {
    complete: activePacketIds.filter((id) => !present.has(id)),
    active: activePacketIds.filter((id) => present.has(id) && !cancel.has(id)),
    cancel: activePacketIds.filter((id) => cancel.has(id)),
  };
}

export function buildReconciliationChoices(
  activePacketIds: string[],
  outcomes: ReadonlyMap<string, ReconciliationOutcome>,
): { unreviewed: string[]; active: string[]; complete: string[]; cancel: string[] } {
  return {
    unreviewed: activePacketIds.filter((id) => !outcomes.has(id)),
    active: activePacketIds.filter((id) => outcomes.get(id) === 'still-here'),
    complete: activePacketIds.filter((id) => outcomes.get(id) === 'taken'),
    cancel: activePacketIds.filter((id) => outcomes.get(id) === 'discarded'),
  };
}

function exactStringArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value as string[];
}

export function parseReconciliationInput(value: unknown): ReconciliationInput {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'activePacketIds,batchId,cancelPacketIds,presentPacketIds'
  ) {
    throw new Error('Invalid reconciliation request');
  }
  const input = value as Record<string, unknown>;
  const activePacketIds = exactStringArray(input.activePacketIds);
  const presentPacketIds = exactStringArray(input.presentPacketIds);
  const cancelPacketIds = exactStringArray(input.cancelPacketIds);
  if (
    typeof input.batchId !== 'string' ||
    input.batchId.length === 0 ||
    !activePacketIds ||
    activePacketIds.length === 0 ||
    !presentPacketIds ||
    !cancelPacketIds
  ) {
    throw new Error('Invalid reconciliation request');
  }
  const active = new Set(activePacketIds);
  const present = new Set(presentPacketIds);
  if (
    presentPacketIds.some((id) => !active.has(id)) ||
    cancelPacketIds.some((id) => !present.has(id))
  ) {
    throw new Error('Invalid reconciliation request');
  }
  return {
    batchId: input.batchId,
    activePacketIds,
    presentPacketIds,
    cancelPacketIds,
  };
}

export function parsePacketCompletionCorrection(
  value: unknown,
  asOf: string,
): PacketCompletionCorrectionInput {
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
  if (typeof input.coveredOn === 'string') {
    try {
      validateCoverageDate(input.coveredOn, asOf);
    } catch {
      throw new Error('Invalid packet correction request');
    }
  }
  return { packetId: input.packetId, coveredOn: input.coveredOn as string | null };
}
