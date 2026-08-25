import {
  type ApartmentSaveFailure,
  optimisticApartmentConfiguration,
  resolveApartmentMutation,
} from '../components/apartment-mutation-state.ts';
import { readMutationResult } from '../components/operation-state.ts';
import { APARTMENTS_ENABLED } from './product-capabilities.ts';
import {
  activateSegments,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  setSegmentsExcluded,
  territoryDraftFromWorkspace,
} from './territory-client.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from './territory-draft.ts';
import type { BoundaryShape, Position } from './territory-geometry.ts';
import { needsTerritoryImport } from './territory-import.ts';
import type { TerritoryImportJob, TerritoryImportStage } from './territory-import-job.ts';
import type {
  ApartmentSiteConfigurationInput,
  ApartmentSiteMembershipInput,
  TerritoryWorkspace,
} from './territory-workspace.ts';

const ACTIVE_POLL_MS = 1_500;
const TRANSIENT_POLL_MS = 3_000;

type ImportTarget = 'contained' | 'import';

export type AddressCandidate = {
  formattedAddress: string;
  center: Position;
};

export type AddressResolution =
  | { ok: true; candidate: AddressCandidate }
  | { ok: false; message: string };

export type RegionSetupEdit =
  | { kind: 'address-candidate'; candidate: AddressCandidate | null }
  | { kind: 'location'; originAddress: string; center: Position }
  | { kind: 'radius'; radiusMiles: number }
  | { kind: 'shape'; boundaryShape: BoundaryShape }
  | {
      kind: 'segments';
      ids: readonly string[];
      disposition: 'activate' | 'exclude' | 'restore';
    };

export type RegionSetupOperation =
  | { kind: 'idle' }
  | { kind: 'saving'; target: ImportTarget }
  | { kind: 'importing'; stage: TerritoryImportStage; placement: 'surface' | 'global' }
  | {
      kind: 'failed';
      target: ImportTarget;
      message: string;
      recovery: 'retry' | 'reload';
      placement: 'surface' | 'global';
    }
  | { kind: 'completed'; target: 'import'; placement: 'surface' | 'global' };

export type RegionSetupAddressLookup =
  | { kind: 'idle'; candidate: null }
  | { kind: 'looking'; candidate: null }
  | { kind: 'candidate'; candidate: AddressCandidate }
  | { kind: 'failed'; candidate: null; message: string };

type RegionSetupApartmentState = {
  savingId: string | null;
  failure: ApartmentSaveFailure | null;
};

export type RegionSetupReadyView = {
  kind: 'ready';
  accepted: TerritoryWorkspace;
  draft: TerritoryDraftInput;
  displayed: Pick<TerritoryWorkspace, 'segments' | 'totals'>;
  dirty: boolean;
  importRequired: boolean;
  canSave: boolean;
  mutationLocked: boolean;
  leaveProtection: 'free' | 'confirm' | 'preserve-mounted';
  setupRequired: boolean;
  operation: RegionSetupOperation;
  addressLookup: RegionSetupAddressLookup;
  apartment: RegionSetupApartmentState | null;
  notice: string;
};

export type RegionSetupView =
  | { kind: 'loading'; operation: { kind: 'idle' } }
  | { kind: 'unavailable'; message: string; recovery: 'retry'; operation: { kind: 'idle' } }
  | RegionSetupReadyView;

export type RegionSetupTransport = {
  loadTerritory: () => Promise<Response>;
  saveTerritory: (draft: TerritoryDraftInput) => Promise<Response>;
  observeImport: () => Promise<Response>;
  resolveAddress: (query: string) => Promise<Response>;
  saveApartmentConfiguration: (input: ApartmentSiteConfigurationInput) => Promise<Response>;
  saveApartmentMembership: (input: ApartmentSiteMembershipInput) => Promise<Response>;
};

export type RegionSetupScheduler = {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
};

export type RegionSetupApartmentWorkflow = Readonly<{
  saveConfiguration: (input: ApartmentSiteConfigurationInput) => Promise<void>;
  saveMembership: (input: ApartmentSiteMembershipInput) => Promise<string | null>;
  retry: () => Promise<void>;
}>;

export type RegionSetupWorkflow = Readonly<{
  getSnapshot: () => RegionSetupView;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  edit: (change: RegionSetupEdit) => void;
  resolveAddress: (query: string) => Promise<AddressResolution>;
  save: (after: 'stay' | 'leave') => Promise<void>;
  discard: (after: 'stay' | 'leave') => void;
  recover: () => Promise<void>;
  dismiss: () => void;
  apartments: RegionSetupApartmentWorkflow | null;
}>;

type WorkflowOptions = {
  initialSetup: boolean;
  onAccepted: (event: { refreshMapData: boolean; completedInitialSetup: boolean }) => Promise<void>;
  onLeaveReady: () => void;
  transport?: RegionSetupTransport;
  scheduler?: RegionSetupScheduler;
  reload?: () => void;
};

type InternalState = {
  load: 'loading' | 'unavailable' | 'ready';
  loadError: string;
  accepted: TerritoryWorkspace | null;
  draft: TerritoryDraftInput | null;
  setupRequired: boolean;
  operation: RegionSetupOperation;
  addressLookup: RegionSetupAddressLookup;
  apartment: RegionSetupApartmentState;
  notice: string;
};

const importStageOrder: Record<TerritoryImportStage, number> = {
  queued: 0,
  downloading_streets: 1,
  downloading_buildings: 2,
  matching: 3,
  preparing: 4,
  saving: 5,
};

function browserTransport(): RegionSetupTransport {
  async function request(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
  return {
    loadTerritory: () => request('/api/territory'),
    saveTerritory: (draft) =>
      request('/api/territory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      }),
    observeImport: () => request('/api/territory/import'),
    resolveAddress: (address) =>
      request('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      }),
    saveApartmentConfiguration: (input) =>
      request('/api/territory/apartment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    saveApartmentMembership: (input) =>
      request('/api/territory/apartment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  };
}

const browserScheduler: RegionSetupScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isAreaGeometry(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.type === 'Polygon' || value.type === 'MultiPolygon') &&
    Array.isArray(value.coordinates)
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

function isApartmentEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceId === 'string' &&
    isNullableString(value.address) &&
    isPosition(value.position) &&
    (value.geometry === null || isAreaGeometry(value.geometry)) &&
    typeof value.apartmentBuilding === 'boolean' &&
    isNumber(value.distinctUnits)
  );
}

function isApartmentSite(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceId === 'string' &&
    isNullableString(value.name) &&
    isNullableString(value.address) &&
    isPosition(value.position) &&
    (value.boundary === null || isAreaGeometry(value.boundary)) &&
    ['source_boundary', 'ungrouped', 'admin_group'].includes(String(value.groupingKind)) &&
    typeof value.groupingConfirmed === 'boolean' &&
    typeof value.addressConfirmed === 'boolean' &&
    (value.tractCount === null || isNumber(value.tractCount)) &&
    ['unknown', 'open', 'restricted'].includes(String(value.accessStatus)) &&
    typeof value.includedInPackets === 'boolean' &&
    typeof value.packetReady === 'boolean' &&
    Array.isArray(value.members) &&
    value.members.every(isApartmentEvidence) &&
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

function isTerritoryWorkspacePayload(value: unknown): value is TerritoryWorkspace {
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
    Array.isArray(value.apartmentSites) &&
    value.apartmentSites.every(isApartmentSite) &&
    Array.isArray(value.apartmentComplexes) &&
    value.apartmentComplexes.every(isApartmentSite) &&
    Array.isArray(value.segments) &&
    value.segments.every(isTerritorySegment) &&
    isRecord(value.totals) &&
    isNumber(value.totals.allSegments) &&
    isNumber(value.totals.eligibleSegments) &&
    isNumber(value.totals.allHomes) &&
    isNumber(value.totals.eligibleHomes)
  );
}

function parseAddressCandidate(value: unknown): AddressCandidate | null {
  if (!isRecord(value) || typeof value.formattedAddress !== 'string') return null;
  if (
    !Array.isArray(value.center) ||
    value.center.length !== 2 ||
    value.center.some(
      (coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate),
    )
  ) {
    return null;
  }
  return {
    formattedAddress: value.formattedAddress,
    center: [value.center[0] as number, value.center[1] as number],
  };
}

function parseImportJob(value: unknown): TerritoryImportJob | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(String(value.status)) ||
    !Object.hasOwn(importStageOrder, String(value.stage)) ||
    (value.error !== null && typeof value.error !== 'string') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  try {
    return {
      id: value.id,
      status: value.status as TerritoryImportJob['status'],
      stage: value.stage as TerritoryImportStage,
      draft: parseTerritoryDraft(value.draft),
      error: value.error as string | null,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failureMessage(target: ImportTarget): string {
  return target === 'import'
    ? 'Streetlight could not confirm whether street data preparation started. Reload to verify before trying again.'
    : 'Streetlight could not confirm whether the region changes were saved. Reload to verify before trying again.';
}

function placement(setupRequired: boolean, target: ImportTarget): 'surface' | 'global' {
  return target === 'import' && !setupRequired ? 'global' : 'surface';
}

function cloneDraft(draft: TerritoryDraftInput): TerritoryDraftInput {
  return structuredClone(draft);
}

export function createRegionSetupWorkflow(options: WorkflowOptions): RegionSetupWorkflow {
  const transport = options.transport ?? browserTransport();
  const scheduler = options.scheduler ?? browserScheduler;
  const reload = options.reload ?? (() => window.location.reload());
  const listeners = new Set<() => void>();
  const state: InternalState = {
    load: 'loading',
    loadError: '',
    accepted: null,
    draft: null,
    setupRequired: options.initialSetup,
    operation: { kind: 'idle' },
    addressLookup: { kind: 'idle', candidate: null },
    apartment: { savingId: null, failure: null },
    notice: 'Saved region loaded.',
  };
  let snapshot: RegionSetupView = { kind: 'loading', operation: { kind: 'idle' } };
  let started = false;
  let generation = 0;
  let timer: unknown = null;
  let trackedJobId: string | null = null;
  let retryDraft: TerritoryDraftInput | null = null;
  let retryAfter: 'stay' | 'leave' = 'stay';
  let leaveAfterImportSuccess = false;
  let apartmentRetry: ApartmentSaveFailure | null = null;
  let addressRequest = 0;

  function buildSnapshot(): RegionSetupView {
    if (state.load === 'loading') return { kind: 'loading', operation: { kind: 'idle' } };
    if (state.load === 'unavailable' || !state.accepted || !state.draft) {
      return {
        kind: 'unavailable',
        message: state.loadError || 'Could not load region',
        recovery: 'retry',
        operation: { kind: 'idle' },
      };
    }

    const displayed = deriveTerritory(state.accepted.segments, state.draft);
    const dirty = hasUnsavedTerritoryChanges(
      territoryDraftFromWorkspace(state.accepted),
      state.draft,
    );
    const importRequired = needsTerritoryImport(state.accepted.import, state.draft);
    const verificationRequired =
      (state.operation.kind === 'failed' && state.operation.recovery === 'reload') ||
      state.apartment.failure?.recovery === 'reload';
    const mutationLocked =
      state.operation.kind === 'saving' ||
      state.operation.kind === 'importing' ||
      state.apartment.savingId !== null ||
      Boolean(verificationRequired);

    return {
      kind: 'ready',
      accepted: state.accepted,
      draft: state.draft,
      displayed,
      dirty,
      importRequired,
      canSave: dirty || importRequired,
      mutationLocked,
      leaveProtection: mutationLocked ? 'preserve-mounted' : dirty ? 'confirm' : 'free',
      setupRequired: state.setupRequired,
      operation: state.operation,
      addressLookup: state.addressLookup,
      apartment: APARTMENTS_ENABLED ? state.apartment : null,
      notice: state.notice,
    };
  }

  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function clearTimer(): void {
    if (timer === null) return;
    scheduler.cancel(timer);
    timer = null;
  }

  function scheduleObservation(delayMs: number, activeGeneration: number): void {
    clearTimer();
    timer = scheduler.schedule(() => {
      timer = null;
      void observeImport(activeGeneration);
    }, delayMs);
  }

  async function notifyAccepted(
    imported: boolean,
    completedInitialSetup: boolean,
    activeGeneration: number,
  ): Promise<void> {
    try {
      await options.onAccepted({
        refreshMapData: imported,
        completedInitialSetup,
      });
      if (!started || activeGeneration !== generation) return;
      state.notice = imported ? 'Street data refreshed.' : 'Region changes saved.';
    } catch {
      if (!started || activeGeneration !== generation) return;
      state.notice = 'Region saved, but coverage could not refresh. Reload the page to retry.';
    }
    publish();
  }

  async function acceptWorkspace(
    workspace: TerritoryWorkspace,
    imported: boolean,
    activeGeneration: number,
  ): Promise<void> {
    if (!started || activeGeneration !== generation) return;
    const completedInitialSetup = state.setupRequired;
    state.accepted = workspace;
    state.draft = territoryDraftFromWorkspace(workspace);
    state.setupRequired = false;
    state.operation = imported
      ? {
          kind: 'completed',
          target: 'import',
          placement: placement(completedInitialSetup, 'import'),
        }
      : { kind: 'idle' };
    state.addressLookup = { kind: 'idle', candidate: null };
    state.apartment.failure = null;
    state.apartment.savingId = null;
    retryDraft = null;
    trackedJobId = null;
    publish();
    await notifyAccepted(imported, completedInitialSetup, activeGeneration);
    if (imported && leaveAfterImportSuccess && started && activeGeneration === generation) {
      leaveAfterImportSuccess = false;
      options.onLeaveReady();
    }
  }

  function setFailure(target: ImportTarget, message: string, recovery: 'retry' | 'reload'): void {
    state.operation = {
      kind: 'failed',
      target,
      message,
      recovery,
      placement: placement(state.setupRequired, target),
    };
    state.notice = message;
    publish();
  }

  async function observeImport(activeGeneration: number): Promise<void> {
    try {
      const response = await transport.observeImport();
      const body = await responseBody(response);
      if (!started || activeGeneration !== generation) return;
      if (!response.ok || !isRecord(body)) throw new Error('Could not load region import');

      const rawJob = Object.hasOwn(body, 'job') ? body.job : undefined;
      const job = rawJob === null ? null : parseImportJob(rawJob);
      if (rawJob !== null && !job) throw new Error('Invalid region import');
      if (!job) {
        if (trackedJobId) {
          setFailure(
            'import',
            'Streetlight could not reconnect to street data preparation. Reload to verify before trying again.',
            'reload',
          );
        }
        return;
      }
      if (trackedJobId && job.id !== trackedJobId) {
        setFailure(
          'import',
          'Streetlight could not reconnect to street data preparation. Reload to verify before trying again.',
          'reload',
        );
        return;
      }
      if (!trackedJobId && job.status === 'succeeded') return;

      trackedJobId = job.id;
      state.draft = cloneDraft(job.draft);
      if (job.status === 'queued' || job.status === 'running') {
        const currentStage =
          state.operation.kind === 'importing' ? state.operation.stage : ('queued' as const);
        const stage =
          importStageOrder[job.stage] >= importStageOrder[currentStage] ? job.stage : currentStage;
        state.operation = {
          kind: 'importing',
          stage,
          placement: placement(state.setupRequired, 'import'),
        };
        retryDraft = cloneDraft(job.draft);
        state.notice = 'Street data preparation started.';
        publish();
        scheduleObservation(ACTIVE_POLL_MS, activeGeneration);
        return;
      }
      if (job.status === 'succeeded') {
        const workspace = Object.hasOwn(body, 'workspace') ? body.workspace : null;
        if (!isTerritoryWorkspacePayload(workspace)) {
          setFailure(
            'import',
            'Streetlight could not reconnect to street data preparation. Reload to verify before trying again.',
            'reload',
          );
          return;
        }
        await acceptWorkspace(workspace, true, activeGeneration);
        return;
      }

      retryDraft = cloneDraft(job.draft);
      setFailure(
        'import',
        job.error ??
          (job.status === 'interrupted'
            ? 'Street data preparation was interrupted. Your previous saved region is still active.'
            : 'Street data preparation failed. Your previous saved region is still active.'),
        'retry',
      );
    } catch {
      if (!started || activeGeneration !== generation) return;
      if (trackedJobId) scheduleObservation(TRANSIENT_POLL_MS, activeGeneration);
    }
  }

  async function initialize(activeGeneration: number): Promise<void> {
    state.load = 'loading';
    state.loadError = '';
    publish();
    try {
      const response = await transport.loadTerritory();
      const body = await responseBody(response);
      if (!started || activeGeneration !== generation) return;
      if (!response.ok || !isTerritoryWorkspacePayload(body)) {
        const message =
          !response.ok && isRecord(body) && typeof body.error === 'string'
            ? body.error
            : 'Could not load region';
        throw new Error(message);
      }
      state.load = 'ready';
      state.accepted = body;
      state.draft = territoryDraftFromWorkspace(body);
      state.operation = { kind: 'idle' };
      state.notice = 'Saved region loaded.';
      publish();
      await observeImport(activeGeneration);
    } catch (error) {
      if (!started || activeGeneration !== generation) return;
      state.load = 'unavailable';
      state.loadError = error instanceof Error ? error.message : 'Could not load region';
      publish();
    }
  }

  async function submit(
    attemptedDraft: TerritoryDraftInput,
    after: 'stay' | 'leave',
  ): Promise<void> {
    if (!started || state.load !== 'ready' || !state.accepted) return;
    const activeGeneration = generation;
    const target: ImportTarget = needsTerritoryImport(state.accepted.import, attemptedDraft)
      ? 'import'
      : 'contained';
    retryDraft = cloneDraft(attemptedDraft);
    retryAfter = after;
    state.operation = { kind: 'saving', target };
    state.notice = 'Saving changes…';
    publish();

    try {
      const response = await transport.saveTerritory(attemptedDraft);
      const body = await responseBody(response);
      if (!started || activeGeneration !== generation) return;
      if (response.status === 202) {
        const job = isRecord(body) ? parseImportJob(body.job) : null;
        if (!job) throw new Error('Invalid region import response');
        trackedJobId = job.id;
        retryDraft = cloneDraft(job.draft);
        state.draft = cloneDraft(job.draft);
        state.operation = {
          kind: 'importing',
          stage: job.stage,
          placement: placement(state.setupRequired, 'import'),
        };
        state.notice = 'Street data preparation started.';
        leaveAfterImportSuccess = after === 'leave' && state.setupRequired;
        publish();
        if (after === 'leave' && !state.setupRequired) options.onLeaveReady();
        scheduleObservation(ACTIVE_POLL_MS, activeGeneration);
        return;
      }
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          isRecord(body) &&
          typeof body.error === 'string' &&
          body.error.length > 0
        ) {
          setFailure(target, body.error, 'retry');
        } else {
          setFailure(target, failureMessage(target), 'reload');
        }
        return;
      }
      if (!isTerritoryWorkspacePayload(body)) throw new Error('Invalid saved region response');
      await acceptWorkspace(body, false, activeGeneration);
      if (after === 'leave' && started && activeGeneration === generation) options.onLeaveReady();
    } catch {
      if (!started || activeGeneration !== generation) return;
      setFailure(target, failureMessage(target), 'reload');
    }
  }

  function edit(change: RegionSetupEdit): void {
    const current = snapshot;
    if (current.kind !== 'ready' || current.mutationLocked) return;
    if (change.kind === 'address-candidate') {
      addressRequest += 1;
      state.addressLookup = change.candidate
        ? { kind: 'candidate', candidate: change.candidate }
        : { kind: 'idle', candidate: null };
      publish();
      return;
    }

    let draft = current.draft;
    if (change.kind === 'location') {
      addressRequest += 1;
      draft = {
        ...draft,
        originAddress: change.originAddress,
        center: [...change.center],
      };
      state.addressLookup = { kind: 'idle', candidate: null };
    } else if (change.kind === 'radius') {
      if (
        !Number.isFinite(change.radiusMiles) ||
        change.radiusMiles < 1 ||
        change.radiusMiles > 5
      ) {
        return;
      }
      draft = { ...draft, radiusMiles: change.radiusMiles };
    } else if (change.kind === 'shape') {
      draft = { ...draft, boundaryShape: change.boundaryShape };
    } else if (change.disposition === 'activate') {
      draft = activateSegments(draft, change.ids);
    } else {
      draft = setSegmentsExcluded(draft, change.ids, change.disposition === 'exclude');
    }
    state.draft = draft;
    if (state.operation.kind === 'failed' && state.operation.recovery === 'retry') {
      state.operation = { kind: 'idle' };
      retryDraft = null;
    }
    if (state.operation.kind === 'completed') state.operation = { kind: 'idle' };
    state.notice = 'Region draft updated.';
    publish();
  }

  async function resolveAddress(query: string): Promise<AddressResolution> {
    const current = snapshot;
    if (current.kind !== 'ready' || current.mutationLocked) {
      return { ok: false, message: 'Finish the current region operation first.' };
    }
    const activeGeneration = generation;
    const activeRequest = ++addressRequest;
    state.addressLookup = { kind: 'looking', candidate: null };
    publish();
    try {
      const response = await transport.resolveAddress(query);
      const body = await responseBody(response);
      if (!started || activeGeneration !== generation || activeRequest !== addressRequest) {
        return { ok: false, message: 'Address lookup was cancelled.' };
      }
      const candidate = parseAddressCandidate(body);
      if (!response.ok || !candidate) {
        const message =
          isRecord(body) && typeof body.error === 'string'
            ? body.error
            : 'Could not resolve that address';
        state.addressLookup = { kind: 'failed', candidate: null, message };
        publish();
        return { ok: false, message };
      }
      state.addressLookup = { kind: 'candidate', candidate };
      publish();
      return { ok: true, candidate };
    } catch {
      if (!started || activeGeneration !== generation || activeRequest !== addressRequest) {
        return { ok: false, message: 'Address lookup was cancelled.' };
      }
      const message = 'Could not resolve that address';
      state.addressLookup = { kind: 'failed', candidate: null, message };
      publish();
      return { ok: false, message };
    }
  }

  async function save(after: 'stay' | 'leave'): Promise<void> {
    const current = snapshot;
    if (current.kind !== 'ready' || current.mutationLocked || !current.canSave) return;
    if (
      current.operation.kind === 'failed' &&
      current.operation.recovery === 'retry' &&
      retryDraft
    ) {
      await submit(cloneDraft(retryDraft), after);
      return;
    }
    await submit(cloneDraft(current.draft), after);
  }

  function discard(after: 'stay' | 'leave'): void {
    const current = snapshot;
    if (current.kind !== 'ready' || current.mutationLocked) return;
    state.draft = territoryDraftFromWorkspace(current.accepted);
    state.operation = { kind: 'idle' };
    state.addressLookup = { kind: 'idle', candidate: null };
    addressRequest += 1;
    state.notice = 'Unsaved changes discarded.';
    retryDraft = null;
    publish();
    if (after === 'leave') options.onLeaveReady();
  }

  async function recover(): Promise<void> {
    if (snapshot.kind === 'unavailable') {
      await initialize(generation);
      return;
    }
    if (snapshot.kind !== 'ready') return;
    if (snapshot.operation.kind === 'failed') {
      if (snapshot.operation.recovery === 'reload') {
        reload();
        return;
      }
      if (retryDraft) await submit(cloneDraft(retryDraft), retryAfter);
    }
  }

  function dismiss(): void {
    if (state.operation.kind !== 'completed') return;
    state.operation = { kind: 'idle' };
    publish();
  }

  async function saveApartmentConfiguration(input: ApartmentSiteConfigurationInput): Promise<void> {
    if (!APARTMENTS_ENABLED || snapshot.kind !== 'ready' || snapshot.mutationLocked) return;
    const activeGeneration = generation;
    const previousWorkspace = snapshot.accepted;
    const optimistic = optimisticApartmentConfiguration(previousWorkspace, input);
    if (!optimistic) return;
    const mutation = { kind: 'configuration' as const, input };
    state.accepted = optimistic;
    state.apartment = { savingId: input.id, failure: null };
    apartmentRetry = null;
    publish();
    const result = await readMutationResult(
      () => transport.saveApartmentConfiguration(input),
      isTerritoryWorkspacePayload,
    );
    if (!started || activeGeneration !== generation) return;
    const resolved = resolveApartmentMutation(previousWorkspace, mutation, result);
    state.accepted = resolved.workspace;
    state.apartment = { savingId: null, failure: resolved.failure };
    apartmentRetry = resolved.failure;
    publish();
    if (result.status === 'success') await notifyAccepted(false, false, activeGeneration);
  }

  async function saveApartmentMembership(
    input: ApartmentSiteMembershipInput,
  ): Promise<string | null> {
    if (!APARTMENTS_ENABLED || snapshot.kind !== 'ready' || snapshot.mutationLocked) return null;
    const activeGeneration = generation;
    const previousWorkspace = snapshot.accepted;
    const mutation = { kind: 'membership' as const, input };
    state.apartment = { savingId: input.id ?? 'new', failure: null };
    apartmentRetry = null;
    publish();
    const result = await readMutationResult(
      () => transport.saveApartmentMembership(input),
      isTerritoryWorkspacePayload,
    );
    if (!started || activeGeneration !== generation) return null;
    const resolved = resolveApartmentMutation(previousWorkspace, mutation, result);
    state.accepted = resolved.workspace;
    state.apartment = { savingId: null, failure: resolved.failure };
    apartmentRetry = resolved.failure;
    publish();
    if (result.status !== 'success') return null;
    await notifyAccepted(false, false, activeGeneration);
    const selected = input.id
      ? result.value.apartmentSites.find(({ id }) => id === input.id)
      : result.value.apartmentSites.find(
          (site) =>
            site.groupingConfirmed &&
            site.members.length === input.memberIds.length &&
            site.members.every(({ id }) => input.memberIds.includes(id)),
        );
    return selected?.id ?? null;
  }

  async function retryApartment(): Promise<void> {
    if (!APARTMENTS_ENABLED || !apartmentRetry) return;
    const failure = apartmentRetry;
    if (failure.recovery === 'reload') {
      reload();
      return;
    }
    if (failure.mutation.kind === 'configuration') {
      await saveApartmentConfiguration(failure.mutation.input);
    } else {
      await saveApartmentMembership(failure.mutation.input);
    }
  }

  const apartments: RegionSetupApartmentWorkflow | null = APARTMENTS_ENABLED
    ? Object.freeze({
        saveConfiguration: saveApartmentConfiguration,
        saveMembership: saveApartmentMembership,
        retry: retryApartment,
      })
    : null;

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return () => undefined;
      started = true;
      const activeGeneration = ++generation;
      void initialize(activeGeneration);
      return () => {
        if (!started || activeGeneration !== generation) return;
        started = false;
        generation += 1;
        addressRequest += 1;
        clearTimer();
      };
    },
    edit,
    resolveAddress,
    save,
    discard,
    recover,
    dismiss,
    apartments,
  });
}
