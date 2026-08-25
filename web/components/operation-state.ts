import type { FinalizedBatch } from '@/lib/packet-finalization';
import type { ReconciliationWorkspace } from '@/lib/reconciliation';

export type MutationResult<T> =
  | { status: 'success'; value: T }
  | { status: 'rejected'; message: string; recovery: 'retry' }
  | { status: 'uncertain'; recovery: 'reload' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPosition(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber);
}

function isLineString(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'LineString' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 &&
    value.coordinates.every(isPosition)
  );
}

function isPacketSegment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isLineString(value.geometry) &&
    isNumber(value.estimatedHomes)
  );
}

function isStart(value: unknown): boolean {
  return isRecord(value) && typeof value.address === 'string' && isPosition(value.position);
}

function isFinalizedPacket(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    (value.kind === undefined || value.kind === 'apartment') &&
    (value.apartmentId === undefined || typeof value.apartmentId === 'string') &&
    (value.kind !== 'apartment' || typeof value.apartmentId === 'string') &&
    isNumber(value.targetHomes) &&
    isNumber(value.estimatedHomes) &&
    ['red', 'orange', 'yellow', 'green'].includes(String(value.coverageClass)) &&
    Array.isArray(value.segments) &&
    value.segments.every(isPacketSegment) &&
    isStart(value.start) &&
    Array.isArray(value.streetNames) &&
    value.streetNames.every((name) => typeof name === 'string')
  );
}

export function isFinalizedBatchPayload(value: unknown): value is FinalizedBatch {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.finalizedAt === 'string' &&
    isNumber(value.packetCount) &&
    isNumber(value.estimatedHomes) &&
    Array.isArray(value.packets) &&
    value.packets.every(isFinalizedPacket)
  );
}

function isReconciliationHistory(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.completionGroupId === 'string' &&
    typeof value.originalCoveredOn === 'string' &&
    isNullableString(value.effectiveCoveredOn)
  );
}

function isReconciliationPacket(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    (value.kind === 'street' || value.kind === 'apartment') &&
    ['active', 'completed', 'cancelled'].includes(String(value.status)) &&
    isNumber(value.estimatedTracts) &&
    isStart(value.start) &&
    Array.isArray(value.segments) &&
    value.segments.every(isPacketSegment) &&
    (value.apartment === null ||
      (isRecord(value.apartment) &&
        typeof value.apartment.id === 'string' &&
        isPosition(value.apartment.position))) &&
    isNullableString(value.completedOn) &&
    Array.isArray(value.history) &&
    value.history.every(isReconciliationHistory)
  );
}

function isReconciliationBatch(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    ['draft', 'finalized', 'reconciled', 'cancelled'].includes(String(value.status)) &&
    isNullableString(value.finalizedAt) &&
    Array.isArray(value.packets) &&
    value.packets.every(isReconciliationPacket) &&
    isRecord(value.counts) &&
    isNumber(value.counts.active) &&
    isNumber(value.counts.completed) &&
    isNumber(value.counts.cancelled)
  );
}

export function isReconciliationWorkspacePayload(value: unknown): value is ReconciliationWorkspace {
  return (
    isRecord(value) &&
    typeof value.asOf === 'string' &&
    isNullableString(value.defaultBatchId) &&
    Array.isArray(value.batches) &&
    value.batches.every(isReconciliationBatch)
  );
}

export async function readMutationResult<T>(
  request: () => Promise<Response>,
  isSuccess: (value: unknown) => value is T,
): Promise<MutationResult<T>> {
  try {
    const response = await request();
    const body: unknown = await response.json();
    if (!response.ok) {
      return response.status >= 400 &&
        response.status < 500 &&
        body &&
        typeof body === 'object' &&
        'error' in body &&
        typeof body.error === 'string' &&
        body.error.length > 0
        ? { status: 'rejected', message: body.error, recovery: 'retry' }
        : { status: 'uncertain', recovery: 'reload' };
    }
    return isSuccess(body)
      ? { status: 'success', value: body }
      : { status: 'uncertain', recovery: 'reload' };
  } catch {
    return { status: 'uncertain', recovery: 'reload' };
  }
}

type FocusTarget = { focus(): void } | null;

export function focusFinalizationConfirmation(
  confirming: boolean,
  confirmation: FocusTarget,
): void {
  if (confirming) confirmation?.focus();
}

export function restoreFinalizationTrigger(
  trigger: FocusTarget,
  schedule: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
): void {
  schedule(() => trigger?.focus());
}

type PacketOperationState = {
  downloading: 'newest' | 'active' | null;
  finalizing: boolean;
  generating: boolean;
  verificationRequired: boolean;
};

export function packetOperationControls(state: PacketOperationState, activePackets: number) {
  const busy =
    state.generating ||
    state.finalizing ||
    state.downloading !== null ||
    state.verificationRequired;
  return {
    activePdfDisabled: busy || activePackets === 0,
    busy,
    finalizationDisabled: busy,
    newestPdfDisabled: busy,
    proposalDisabled: busy,
    requestDisabled: busy,
  };
}

export type CorrectionAttempt = {
  packetId: string;
  coveredOn: string | null;
};

export type ReconciliationCorrectionFeedback = {
  attempt: CorrectionAttempt;
  detail: string;
  headline: string;
  operation: 'correction';
  recovery?: 'retry' | 'reload';
  tone: 'error' | 'success';
};

type CorrectionControl = {
  busy: boolean;
  feedback: ReconciliationCorrectionFeedback | null;
  action: { kind: 'reload' } | { kind: 'retry'; attempt: CorrectionAttempt } | null;
};

export function correctionControlForPacket(
  packetId: string,
  activeAttempt: CorrectionAttempt | null,
  feedback: ReconciliationCorrectionFeedback | null,
): CorrectionControl {
  const packetFeedback = feedback?.attempt.packetId === packetId ? feedback : null;
  return {
    busy: activeAttempt?.packetId === packetId,
    feedback: packetFeedback,
    action:
      packetFeedback?.recovery === 'reload'
        ? { kind: 'reload' }
        : packetFeedback?.tone === 'error'
          ? { kind: 'retry', attempt: packetFeedback.attempt }
          : null,
  };
}

export function reconciliationMutationControlsDisabled(
  operationActive: boolean,
  recovery?: 'retry' | 'reload',
): boolean {
  return operationActive || recovery === 'reload';
}
