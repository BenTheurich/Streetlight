import type { TerritoryWorkspace } from '@/lib/database';
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

function isImportQuality(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.totalAddresses) &&
    isNumber(value.assignedAddresses) &&
    isNumber(value.spatiallyAssignedAddresses) &&
    isNumber(value.inferredRoads) &&
    isNumber(value.unmatchedAddresses) &&
    isNumber(value.unresolvedClusters) &&
    isNumber(value.totalResidentialBuildings) &&
    isNumber(value.fallbackBuildings) &&
    isNumber(value.unmatchedResidentialBuildings) &&
    isNumber(value.populatedUnnamedRoads) &&
    isNumber(value.buildingAddressDisagreements) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string')
  );
}

function isTerritoryImport(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'proof' || value.kind === 'overture') &&
    isNullableString(value.release) &&
    (value.center === null || isPosition(value.center)) &&
    (value.radiusMiles === null || isNumber(value.radiusMiles)) &&
    isNullableString(value.completedAt) &&
    (value.normalizerVersion === null || isNumber(value.normalizerVersion)) &&
    (value.quality === null || isImportQuality(value.quality))
  );
}

function isApartmentComplex(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceId === 'string' &&
    isNullableString(value.address) &&
    isPosition(value.position) &&
    isNumber(value.estimatedTracts) &&
    isRecord(value.evidence) &&
    typeof value.evidence.apartmentBuilding === 'boolean' &&
    isNumber(value.evidence.distinctUnits) &&
    ['needs_review', 'ready', 'deferred'].includes(String(value.reviewStatus)) &&
    typeof value.withinBoundary === 'boolean'
  );
}

function isTerritorySegment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceSegmentId === 'string' &&
    typeof value.roadGroupId === 'string' &&
    typeof value.roadClass === 'string' &&
    typeof value.streetName === 'string' &&
    isLineString(value.geometry) &&
    isNumber(value.estimatedHomes) &&
    ['automatic', 'hidden', 'manual'].includes(String(value.activationKind)) &&
    typeof value.active === 'boolean' &&
    typeof value.withinBoundary === 'boolean' &&
    typeof value.manuallyExcluded === 'boolean' &&
    typeof value.eligible === 'boolean' &&
    (value.excludedReason === null ||
      ['hidden', 'boundary', 'segment'].includes(String(value.excludedReason)))
  );
}

export function isTerritoryWorkspacePayload(value: unknown): value is TerritoryWorkspace {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.churchName === 'string' &&
    typeof value.name === 'string' &&
    typeof value.originAddress === 'string' &&
    isPosition(value.center) &&
    isNumber(value.radiusMiles) &&
    (value.boundaryShape === 'circle' || value.boundaryShape === 'square') &&
    isTerritoryImport(value.import) &&
    Array.isArray(value.apartmentComplexes) &&
    value.apartmentComplexes.every(isApartmentComplex) &&
    Array.isArray(value.segments) &&
    value.segments.every(isTerritorySegment) &&
    isRecord(value.totals) &&
    isNumber(value.totals.allSegments) &&
    isNumber(value.totals.eligibleSegments) &&
    isNumber(value.totals.allHomes) &&
    isNumber(value.totals.eligibleHomes)
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

export function packetRequestControlsDisabled(state: {
  downloading: 'newest' | 'active' | null;
  finalizing: boolean;
  generating: boolean;
  verificationRequired: boolean;
}): boolean {
  return (
    state.generating || state.finalizing || state.downloading !== null || state.verificationRequired
  );
}

export function territoryLeaveControlsDisabled(state: {
  saving: boolean;
  verificationRequired: boolean;
}): boolean {
  return state.saving || state.verificationRequired;
}
