'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { coverageRoads } from '@/lib/coverage';
import type {
  ApartmentSite,
  ApartmentSiteConfigurationInput,
  ApartmentSiteMembershipInput,
  TerritoryWorkspace,
} from '@/lib/database';
import { loadGoogleMaps } from '@/lib/google-maps-browser';
import {
  activateSegments,
  apartmentSiteReady,
  apartmentSiteSummary,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  setSegmentsExcluded,
  territoryDraftFromWorkspace,
  withApartmentSiteConfiguration,
} from '@/lib/territory-client';
import { parseTerritoryDraft } from '@/lib/territory-draft';
import { type Position, pointInsideTerritoryBoundary } from '@/lib/territory-geometry';
import { needsTerritoryImport } from '@/lib/territory-import';
import type { TerritoryImportJob, TerritoryImportStage } from '@/lib/territory-import-job';
import {
  type ApartmentSelectionSource,
  apartmentReviewOptions,
  createApartmentSelection,
} from '@/lib/territory-map-style';
import { OpenTerritoryMap } from './OpenTerritoryMap';
import { OperationStatus } from './OperationStatus';
import {
  isTerritoryWorkspacePayload,
  readMutationResult,
  territoryLeaveControlsDisabled,
} from './operation-state';
import { setupToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

type PendingAddress = {
  formattedAddress: string;
  center: Position;
};

type TerritorySaveFailure = {
  message: string;
  recovery: 'retry' | 'reload';
  willImport: boolean;
};

type ApartmentSaveFailure = {
  id: string;
  mutation:
    | { kind: 'configuration'; input: ApartmentSiteConfigurationInput }
    | { kind: 'membership'; input: ApartmentSiteMembershipInput };
  message: string;
  recovery: 'retry' | 'reload';
};

type ReviewSection = 'region' | 'apartments' | 'roads' | 'quality';

const REVIEW_SECTION_CLOSE_MS = 150;

function apartmentConfiguration(
  site: ApartmentSite,
  overrides: Partial<Omit<ApartmentSiteConfigurationInput, 'id'>> = {},
): ApartmentSiteConfigurationInput {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    addressConfirmed: site.addressConfirmed,
    tractCount: site.tractCount,
    accessStatus: site.accessStatus,
    groupingConfirmed: site.groupingConfirmed,
    includedInPackets: site.includedInPackets,
    ...overrides,
  };
}

const importStageLabels: Record<TerritoryImportStage, string> = {
  queued: 'Street data refresh queued',
  downloading_streets: 'Downloading streets and addresses',
  downloading_buildings: 'Downloading building footprints',
  matching: 'Matching homes to streets',
  preparing: 'Preparing region data',
  saving: 'Saving region',
};

function readTerritoryImportJob(value: unknown): TerritoryImportJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const job = value as Record<string, unknown>;
  if (
    typeof job.id !== 'string' ||
    !['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(String(job.status)) ||
    !Object.hasOwn(importStageLabels, String(job.stage)) ||
    (job.error !== null && typeof job.error !== 'string') ||
    typeof job.createdAt !== 'string' ||
    typeof job.updatedAt !== 'string'
  ) {
    return null;
  }
  try {
    return {
      id: job.id,
      status: job.status as TerritoryImportJob['status'],
      stage: job.stage as TerritoryImportStage,
      draft: parseTerritoryDraft(job.draft),
      error: job.error as string | null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  } catch {
    return null;
  }
}

export function TerritoryEditor({
  active,
  initialData,
  map,
  mapVisible,
  mapsApiKey,
  overlayRoot,
  onDirtyChange,
  onDiscardAndLeave,
  onImportingChange,
  onReturnToSetup,
  onSaved,
  onSaveAndLeave,
  onStay,
  onViewChange,
  pendingLeave,
  setupRequired,
}: {
  active: boolean;
  initialData: TerritoryWorkspace;
  map: MapLibreMap | null;
  mapVisible: boolean;
  mapsApiKey: string;
  overlayRoot: HTMLDivElement | null;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardAndLeave: () => void;
  onImportingChange: (importing: boolean) => void;
  onReturnToSetup: () => void;
  onSaved: (workspace: TerritoryWorkspace, imported: boolean) => Promise<void>;
  onSaveAndLeave: () => void;
  onStay: () => void;
  onViewChange: (view: 'territory' | 'printouts') => void;
  pendingLeave: boolean;
  setupRequired: boolean;
}) {
  const initialDraft = territoryDraftFromWorkspace(initialData);
  const [savedWorkspace, setSavedWorkspace] = useState(initialData);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [showHiddenRoads, setShowHiddenRoads] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [roadFocusRequest, setRoadFocusRequest] = useState<{
    ids: string[];
    key: number;
  } | null>(null);
  const [boxSelectionArmed, setBoxSelectionArmed] = useState(false);
  const [roadSearch, setRoadSearch] = useState('');
  const [apartmentSearch, setApartmentSearch] = useState('');
  const [apartmentSelection, setApartmentSelection] = useState<{
    id: string;
    source: ApartmentSelectionSource;
  } | null>(null);
  const [groupingApartment, setGroupingApartment] = useState<{
    siteId: string | null;
    memberIds: string[];
  } | null>(null);
  const [radiusInput, setRadiusInput] = useState(String(initialDraft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [openReviewSection, setOpenReviewSection] = useState<ReviewSection | null>(
    setupRequired ? 'region' : 'roads',
  );
  const [addressQuery, setAddressQuery] = useState(initialDraft.originAddress);
  const [pendingAddress, setPendingAddress] = useState<PendingAddress | null>(null);
  const [placeSearchFailed, setPlaceSearchFailed] = useState(!mapsApiKey);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importJob, setImportJob] = useState<TerritoryImportJob | null>(null);
  const [saveFailure, setSaveFailure] = useState<TerritorySaveFailure | null>(null);
  const [savingApartmentId, setSavingApartmentId] = useState<string | null>(null);
  const [apartmentSaveFailure, setApartmentSaveFailure] = useState<ApartmentSaveFailure | null>(
    null,
  );
  const [backgroundImportComplete, setBackgroundImportComplete] = useState(false);
  const [notice, setNotice] = useState('Saved region loaded.');
  const addressInputRef = useRef<HTMLInputElement>(null);
  const placeSearchRef = useRef<HTMLDivElement>(null);
  const reviewSectionTransitionRef = useRef<number | null>(null);

  const live = useMemo(
    () => deriveTerritory(savedWorkspace.segments, draft),
    [draft, savedWorkspace.segments],
  );
  const liveApartments = useMemo(
    () =>
      savedWorkspace.apartmentSites.map((apartment) => ({
        ...apartment,
        withinBoundary: pointInsideTerritoryBoundary(
          apartment.position,
          draft.center,
          draft.radiusMiles,
          draft.boundaryShape,
        ),
      })),
    [draft.boundaryShape, draft.center, draft.radiusMiles, savedWorkspace.apartmentSites],
  );
  const apartmentSummary = apartmentSiteSummary(
    liveApartments.filter(({ withinBoundary }) => withinBoundary),
  );
  const hasUnsavedChanges = hasUnsavedTerritoryChanges(savedDraft, draft);
  const isDirty = hasUnsavedChanges;
  const importRequired = needsTerritoryImport(savedWorkspace.import, draft);
  const canSave = isDirty || importRequired;
  const verificationRequired =
    saveFailure?.recovery === 'reload' || apartmentSaveFailure?.recovery === 'reload';
  const leaveControlsDisabled = territoryLeaveControlsDisabled({
    saving: saving || importing || savingApartmentId !== null,
    verificationRequired,
  });
  const radiusError =
    !Number.isFinite(Number(radiusInput)) || Number(radiusInput) < 1 || Number(radiusInput) > 5
      ? 'Enter a boundary distance from 1 to 5 miles.'
      : '';
  const selectedIdSet = new Set(selectedSegmentIds);
  const selectedSegments = live.segments.filter(
    (segment) => segment.withinBoundary && selectedIdSet.has(segment.id),
  );
  const includedSelected = selectedSegments.filter(
    (segment) => segment.active && !segment.manuallyExcluded,
  );
  const excludedSelected = selectedSegments.filter((segment) => segment.manuallyExcluded);
  const hiddenSelected = selectedSegments.filter((segment) => !segment.active);
  const normalizedRoadSearch = roadSearch.trim().toLocaleLowerCase();
  const roadSearchResults = normalizedRoadSearch
    ? coverageRoads(
        live.segments.filter(
          (segment) =>
            segment.withinBoundary &&
            (segment.active || segment.manuallyExcluded || showHiddenRoads) &&
            (segment.streetName || 'Unnamed road')
              .toLocaleLowerCase()
              .includes(normalizedRoadSearch),
        ),
      )
        .sort((left, right) => left.streetName.localeCompare(right.streetName))
        .slice(0, 20)
    : [];
  const apartmentOptions = useMemo(
    () =>
      apartmentReviewOptions(
        liveApartments.filter(({ withinBoundary }) => withinBoundary),
        live.segments.filter(({ withinBoundary }) => withinBoundary),
        '',
      ),
    [live.segments, liveApartments],
  );
  const apartmentSearchResults = useMemo(
    () =>
      apartmentReviewOptions(
        liveApartments.filter(({ withinBoundary }) => withinBoundary),
        live.segments.filter(({ withinBoundary }) => withinBoundary),
        apartmentSearch,
      ).slice(0, apartmentSearch.trim() ? 20 : 8),
    [apartmentSearch, live.segments, liveApartments],
  );
  const selectedApartment =
    liveApartments.find(
      (apartment) => apartment.withinBoundary && apartment.id === apartmentSelection?.id,
    ) ?? null;
  const selectedApartmentOption = apartmentOptions.find(
    ({ apartment }) => apartment.id === selectedApartment?.id,
  );
  const selectedApartmentBuildingCount =
    selectedApartment?.members.filter(({ apartmentBuilding }) => apartmentBuilding).length ?? 0;
  const selectedApartmentUnitCount =
    selectedApartment?.members.reduce((total, member) => total + member.distinctUnits, 0) ?? 0;
  const apartmentConfigurationSaving = savingApartmentId !== null;
  const groupableApartments = liveApartments.filter(
    (site) =>
      site.withinBoundary && (!site.groupingConfirmed || site.id === groupingApartment?.siteId),
  );
  const toggleApartmentMember = useCallback((id: string) => {
    setGroupingApartment((current) =>
      current
        ? {
            ...current,
            memberIds: current.memberIds.includes(id)
              ? current.memberIds.filter((memberId) => memberId !== id)
              : [...current.memberIds, id],
          }
        : current,
    );
  }, []);

  const acceptSavedWorkspace = useCallback(
    async (result: TerritoryWorkspace, imported: boolean) => {
      const nextDraft = territoryDraftFromWorkspace(result);
      setSavedWorkspace(result);
      setDraft(nextDraft);
      setSavedDraft(structuredClone(nextDraft));
      setRadiusInput(String(nextDraft.radiusMiles));
      setSelectedSegmentIds([]);
      setRoadFocusRequest(null);
      setBoxSelectionArmed(false);
      setApartmentSearch('');
      setApartmentSelection(null);
      setSaving(false);
      setImporting(false);
      setBackgroundImportComplete(imported);
      try {
        await onSaved(result, imported);
        setNotice(imported ? 'Street data refreshed.' : 'Region changes saved.');
      } catch {
        setNotice('Region saved, but coverage could not refresh. Reload the page to retry.');
      }
    },
    [onSaved],
  );

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  useEffect(() => onDirtyChange(hasUnsavedChanges), [hasUnsavedChanges, onDirtyChange]);

  useEffect(
    () => onImportingChange(leaveControlsDisabled),
    [leaveControlsDisabled, onImportingChange],
  );

  useEffect(() => {
    if (addressEditing) {
      addressInputRef.current?.focus();
    }
  }, [addressEditing]);

  useEffect(
    () => () => {
      if (reviewSectionTransitionRef.current !== null) {
        window.clearTimeout(reviewSectionTransitionRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const container = placeSearchRef.current;
    if (!addressEditing || !mapsApiKey || !container) return;
    let disposed = false;

    void loadGoogleMaps(mapsApiKey)
      .then(async (maps) => {
        const { PlaceAutocompleteElement } = (await maps.importLibrary(
          'places',
        )) as google.maps.PlacesLibrary;
        if (disposed) return;
        const autocomplete = new PlaceAutocompleteElement();
        autocomplete.className = 'territory-place-autocomplete';
        autocomplete.description = 'Search for your church or address';
        autocomplete.placeholder = 'Search for your church or address';
        autocomplete.addEventListener('input', () => setPendingAddress(null));
        autocomplete.addEventListener('gmp-select', async (event) => {
          try {
            const place = (
              event as google.maps.places.PlacePredictionSelectEvent
            ).placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress', 'location'] });
            if (disposed || !place.formattedAddress || !place.location) {
              throw new Error('Could not resolve that address');
            }
            const nextAddress: PendingAddress = {
              formattedAddress: place.formattedAddress,
              center: [place.location.lng(), place.location.lat()],
            };
            setAddressQuery(nextAddress.formattedAddress);
            setPendingAddress(nextAddress);
            setNotice('Address found. Confirm the new church location.');
          } catch {
            setPendingAddress(null);
            setNotice('Could not resolve that address. Try another search.');
          }
        });
        container.replaceChildren(autocomplete);
        autocomplete.focus();
      })
      .catch(() => setPlaceSearchFailed(true));

    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [addressEditing, mapsApiKey]);

  const transitionReviewSection = useCallback(
    (nextSection: ReviewSection | null) => {
      const transitionWasPending = reviewSectionTransitionRef.current !== null;
      if (reviewSectionTransitionRef.current !== null) {
        window.clearTimeout(reviewSectionTransitionRef.current);
        reviewSectionTransitionRef.current = null;
      }
      if (nextSection === null) {
        setOpenReviewSection(null);
        return;
      }
      if (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        (openReviewSection === nextSection && !transitionWasPending)
      ) {
        setOpenReviewSection(nextSection);
        return;
      }
      if (openReviewSection === null && !transitionWasPending) {
        setOpenReviewSection(nextSection);
        return;
      }
      setOpenReviewSection(null);
      reviewSectionTransitionRef.current = window.setTimeout(() => {
        setOpenReviewSection(nextSection);
        reviewSectionTransitionRef.current = null;
      }, REVIEW_SECTION_CLOSE_MS);
    },
    [openReviewSection],
  );

  const selectSegments = useCallback(
    (segmentIds: string[], additive: boolean, source: 'map' | 'search' = 'map') => {
      setSelectedSegmentIds((current) => {
        if (!additive) return [...new Set(segmentIds)];
        const next = new Set(current);
        for (const id of segmentIds) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return [...next];
      });
      setRoadFocusRequest((current) =>
        source === 'search' ? { ids: segmentIds, key: (current?.key ?? 0) + 1 } : null,
      );
      setApartmentSelection(null);
      transitionReviewSection('roads');
    },
    [transitionReviewSection],
  );

  const selectApartment = useCallback(
    (apartmentId: string, source: ApartmentSelectionSource) => {
      setApartmentSelection(createApartmentSelection(apartmentId, source));
      setApartmentSearch('');
      setSelectedSegmentIds([]);
      setRoadFocusRequest(null);
      setBoxSelectionArmed(false);
      transitionReviewSection('apartments');
    },
    [transitionReviewSection],
  );

  function cancelChanges() {
    setDraft(structuredClone(savedDraft));
    setRadiusInput(String(savedDraft.radiusMiles));
    setSelectedSegmentIds([]);
    setRoadFocusRequest(null);
    setBoxSelectionArmed(false);
    setApartmentSearch('');
    setApartmentSelection(null);
    setAddressEditing(false);
    setPendingAddress(null);
    setSaveFailure(null);
    setBackgroundImportComplete(false);
    setNotice('Unsaved changes discarded.');
  }

  async function lookUpAddress() {
    setGeocoding(true);
    setPendingAddress(null);
    setNotice('Looking up address…');
    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addressQuery }),
      });
      const result = (await response.json()) as PendingAddress | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not resolve that address');
      }
      setPendingAddress(result);
      setNotice('Address found. Confirm the new church location.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not resolve that address');
    } finally {
      setGeocoding(false);
    }
  }

  async function saveApartmentConfiguration(input: ApartmentSiteConfigurationInput) {
    const previousWorkspace = savedWorkspace;
    const current = previousWorkspace.apartmentSites.find(({ id }) => id === input.id);
    if (!current) return;
    const packetReady = apartmentSiteReady(input);
    const optimistic: ApartmentSite = {
      ...current,
      ...input,
      packetReady,
      includedInPackets: packetReady && input.includedInPackets,
    };
    setSavedWorkspace(withApartmentSiteConfiguration(previousWorkspace, optimistic));
    setSavingApartmentId(input.id);
    setApartmentSaveFailure(null);

    const result = await readMutationResult(
      () =>
        fetch('/api/territory/apartment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      isTerritoryWorkspacePayload,
    );

    setSavingApartmentId(null);
    if (result.status === 'success') {
      setSavedWorkspace(result.value);
      try {
        await onSaved(result.value, false);
      } catch {
        setNotice('Apartment inclusion saved, but coverage could not refresh. Reload to retry.');
      }
      return;
    }

    setSavedWorkspace(previousWorkspace);
    setApartmentSaveFailure({
      id: input.id,
      mutation: { kind: 'configuration', input },
      message:
        result.status === 'rejected'
          ? result.message
          : 'Streetlight could not confirm whether the apartment site was saved.',
      recovery: result.recovery,
    });
  }

  async function saveApartmentMembership(input: ApartmentSiteMembershipInput) {
    setSavingApartmentId(input.id ?? 'new');
    setApartmentSaveFailure(null);
    const result = await readMutationResult(
      () =>
        fetch('/api/territory/apartment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      isTerritoryWorkspacePayload,
    );
    setSavingApartmentId(null);
    if (result.status === 'success') {
      setSavedWorkspace(result.value);
      setGroupingApartment(null);
      const selected = input.id
        ? result.value.apartmentSites.find(({ id }) => id === input.id)
        : result.value.apartmentSites.find(
            (site) =>
              site.groupingConfirmed &&
              site.members.length === input.memberIds.length &&
              site.members.every(({ id }) => input.memberIds.includes(id)),
          );
      if (selected) setApartmentSelection(createApartmentSelection(selected.id, 'map'));
      try {
        await onSaved(result.value, false);
      } catch {
        setNotice('Apartment grouping saved, but coverage could not refresh. Reload to retry.');
      }
      return;
    }
    setApartmentSaveFailure({
      id: input.id ?? 'new',
      mutation: { kind: 'membership', input },
      message:
        result.status === 'rejected'
          ? result.message
          : 'Streetlight could not confirm whether the apartment grouping was saved.',
      recovery: result.recovery,
    });
  }

  function retryApartmentMutation(failure: ApartmentSaveFailure) {
    return failure.mutation.kind === 'configuration'
      ? saveApartmentConfiguration(failure.mutation.input)
      : saveApartmentMembership(failure.mutation.input);
  }

  function confirmAddress() {
    if (!pendingAddress) {
      return;
    }
    setDraft((current) => ({
      ...current,
      originAddress: pendingAddress.formattedAddress,
      center: pendingAddress.center,
    }));
    setAddressQuery(pendingAddress.formattedAddress);
    setAddressEditing(false);
    setPendingAddress(null);
    setNotice('Church location changed in this draft. Road adjustments stayed in place.');
  }

  async function saveChanges(leaveAfterSave = false) {
    const willImport = needsTerritoryImport(savedWorkspace.import, draft);
    const leaveWhileImportRuns = leaveAfterSave && willImport && !setupRequired;
    setSaving(true);
    setImporting(willImport);
    setSaveFailure(null);
    setBackgroundImportComplete(false);
    if (leaveWhileImportRuns) onSaveAndLeave();
    setNotice('Saving changes…');

    try {
      const response = await fetch('/api/territory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body: unknown = await response.json();
      if (response.status === 202) {
        const job = readTerritoryImportJob(
          body && typeof body === 'object' && 'job' in body ? body.job : null,
        );
        if (!job) throw new Error('Invalid region import response');
        setImportJob(job);
        setDraft(job.draft);
        setRadiusInput(String(job.draft.radiusMiles));
        setSaving(false);
        setImporting(true);
        setNotice('Street data preparation started.');
        return;
      }
      if (!response.ok) {
        const message =
          response.status >= 400 &&
          response.status < 500 &&
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof body.error === 'string'
            ? body.error
            : willImport
              ? 'Streetlight could not confirm whether street data preparation started. Reload to verify before trying again.'
              : 'Streetlight could not confirm whether the region changes were saved. Reload to verify before trying again.';
        const recovery = response.status < 500 ? 'retry' : 'reload';
        setSaveFailure({ message, recovery, willImport });
        setNotice(message);
        setSaving(false);
        setImporting(false);
        return;
      }
      if (!isTerritoryWorkspacePayload(body)) {
        throw new Error('Invalid saved region response');
      }
      await acceptSavedWorkspace(body, false);
      if (leaveAfterSave && !leaveWhileImportRuns) onSaveAndLeave();
    } catch {
      const message = willImport
        ? 'Streetlight could not confirm whether street data preparation started. Reload to verify before trying again.'
        : 'Streetlight could not confirm whether the region changes were saved. Reload to verify before trying again.';
      setSaveFailure({ message, recovery: 'reload', willImport });
      setNotice(message);
      setSaving(false);
      setImporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trackedJobId = importJob?.id ?? null;

    async function checkImport() {
      try {
        const response = await fetch('/api/territory/import');
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== 'object') {
          throw new Error('Could not load region import');
        }
        const job = readTerritoryImportJob('job' in body ? body.job : null);
        if (cancelled) return;
        if (!job) {
          if (trackedJobId) {
            const message =
              'Streetlight could not reconnect to street data preparation. Reload to verify before trying again.';
            setSaveFailure({ message, recovery: 'reload', willImport: true });
            setImporting(false);
          }
          return;
        }
        if (!trackedJobId && job.status === 'succeeded') return;

        setImportJob(job);
        if (job.status === 'queued' || job.status === 'running') {
          setDraft(job.draft);
          setAddressQuery(job.draft.originAddress);
          setRadiusInput(String(job.draft.radiusMiles));
          setImporting(true);
          setSaving(false);
          setSaveFailure(null);
          timer = setTimeout(checkImport, 1_500);
          return;
        }
        if (job.status === 'succeeded') {
          const workspace = 'workspace' in body ? body.workspace : null;
          if (!isTerritoryWorkspacePayload(workspace)) {
            throw new Error('Saved region is unavailable');
          }
          await acceptSavedWorkspace(workspace, true);
          return;
        }

        const message =
          job.error ??
          (job.status === 'interrupted'
            ? 'Street data preparation was interrupted. Your previous saved region is still active.'
            : 'Street data preparation failed. Your previous saved region is still active.');
        setDraft(job.draft);
        setAddressQuery(job.draft.originAddress);
        setRadiusInput(String(job.draft.radiusMiles));
        setImporting(false);
        setSaving(false);
        setBackgroundImportComplete(false);
        setSaveFailure({ message, recovery: 'retry', willImport: true });
        setNotice(message);
      } catch {
        if (!cancelled && trackedJobId) timer = setTimeout(checkImport, 3_000);
      }
    }

    void checkImport();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [acceptSavedWorkspace, importJob?.id]);
  const operationPlacement =
    importing || saveFailure?.willImport || backgroundImportComplete
      ? setupRequired
        ? 'surface'
        : 'global'
      : 'surface';
  const saveStatus =
    saving || importing || saveFailure || backgroundImportComplete ? (
      <OperationStatus
        action={
          saveFailure ? (
            saveFailure.recovery === 'reload' ? (
              <button onClick={() => window.location.reload()} type="button">
                Reload to verify
              </button>
            ) : !active && !setupRequired ? (
              <button onClick={onReturnToSetup} type="button">
                Return to Region Setup
              </button>
            ) : undefined
          ) : backgroundImportComplete ? (
            <button onClick={() => setBackgroundImportComplete(false)} type="button">
              Dismiss
            </button>
          ) : undefined
        }
        detail={
          saveFailure
            ? saveFailure.recovery === 'reload'
              ? saveFailure.message
              : saveFailure.willImport
                ? setupRequired
                  ? `${saveFailure.message} Your setup choices are still here.`
                  : `${saveFailure.message} Your previous saved region is still active.`
                : `${saveFailure.message} Your draft is still here.`
            : backgroundImportComplete
              ? 'The street import finished and the region was saved. Reload if map totals have not refreshed.'
              : importing
                ? setupRequired
                  ? 'This usually takes around two minutes. You can safely refresh this page.'
                  : 'This usually takes around two minutes. Your saved region remains active, and you can keep working.'
                : 'Your draft stays here until Streetlight confirms the save.'
        }
        headline={
          saveFailure
            ? saveFailure.recovery === 'reload'
              ? 'Could not confirm region save'
              : saveFailure.willImport
                ? 'Street import did not finish'
                : 'Region changes were not saved'
            : backgroundImportComplete
              ? 'Street data refreshed'
              : importing
                ? importStageLabels[importJob?.stage ?? 'queued']
                : 'Saving region changes'
        }
        placement={operationPlacement}
        tone={saveFailure ? 'error' : backgroundImportComplete ? 'success' : 'busy'}
      />
    ) : null;

  return (
    <>
      <OpenTerritoryMap
        interactive={active}
        apartmentSites={groupingApartment ? groupableApartments : liveApartments}
        apartmentSelectionSource={apartmentSelection?.source ?? null}
        boundaryShape={draft.boundaryShape}
        boxSelectionArmed={boxSelectionArmed}
        center={draft.center}
        map={map}
        groupingMemberIds={groupingApartment?.memberIds ?? null}
        mutationLocked={leaveControlsDisabled}
        onBoxSelectionComplete={() => setBoxSelectionArmed(false)}
        onSelectApartment={(id) => selectApartment(id, 'map')}
        onToggleApartmentMember={toggleApartmentMember}
        onSelectSegments={selectSegments}
        radiusMiles={draft.radiusMiles}
        roadFocusRequest={roadFocusRequest}
        segments={live.segments}
        selectedApartmentId={selectedApartment?.id ?? null}
        selectedApartmentPosition={selectedApartment?.position ?? null}
        selectedSegmentIds={selectedSegmentIds}
        showHiddenRoads={showHiddenRoads}
        visible={mapVisible}
      />
      {mapVisible &&
        overlayRoot &&
        createPortal(
          <>
            <div className="map-legend">
              <span>
                <i className="included" /> Included
              </span>
              <span>
                <i className="excluded" /> Excluded
              </span>
              {showHiddenRoads && (
                <span>
                  <i className="hidden-road" /> Hidden
                </span>
              )}
            </div>
            {active && (
              <div className="map-selection-tools">
                <button
                  aria-pressed={boxSelectionArmed}
                  className={boxSelectionArmed ? 'active' : undefined}
                  onClick={() => {
                    setBoxSelectionArmed((armed) => !armed);
                    transitionReviewSection('roads');
                  }}
                  type="button"
                >
                  {boxSelectionArmed ? 'Drag over roads' : 'Select road area'}
                </button>
                <span>
                  {boxSelectionArmed
                    ? 'Drag a box over road segments'
                    : 'Shift-drag selects road segments'}
                </span>
              </div>
            )}
          </>,
          overlayRoot,
        )}

      <aside
        aria-busy={saving || importing}
        className={`territory-sidebar tool-sidebar${canSave ? ' has-pending-changes' : ''}`}
        hidden={!active}
      >
        {!setupRequired && (
          <ToolViewSwitcher
            label="Setup views"
            onChange={(view) => onViewChange(view as 'territory' | 'printouts')}
            options={setupToolViews}
            value="territory"
          />
        )}
        <div className="sidebar-scroll" inert={saving || importing || verificationRequired}>
          <details className="region-settings-disclosure" open={openReviewSection === 'region'}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is the native disclosure control. */}
            <summary
              onClick={(event) => {
                event.preventDefault();
                transitionReviewSection(openReviewSection === 'region' ? null : 'region');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  transitionReviewSection(openReviewSection === 'region' ? null : 'region');
                }
              }}
            >
              <span className="region-settings-summary-copy">
                <strong>Region settings</strong>
                <span>
                  {draft.originAddress.split(',')[0]} &middot; {draft.radiusMiles}-mile{' '}
                  {draft.boundaryShape}
                </span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <section className="territory-basics-section">
              <div className="region-settings-row">
                <h2>Church location</h2>
                {!addressEditing ? (
                  <div className="address-card">
                    <strong>{draft.originAddress}</strong>
                    <button
                      onClick={() => {
                        setAddressEditing(true);
                        setAddressQuery('');
                        setPendingAddress(null);
                      }}
                      type="button"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="address-editor">
                    <label htmlFor={placeSearchFailed ? 'church-address' : undefined}>
                      Church or address
                    </label>
                    {placeSearchFailed ? (
                      <input
                        autoComplete="street-address"
                        id="church-address"
                        onChange={(event) => {
                          setAddressQuery(event.target.value);
                          setPendingAddress(null);
                        }}
                        placeholder="Search for your church or address"
                        ref={addressInputRef}
                        value={addressQuery}
                      />
                    ) : (
                      <div ref={placeSearchRef} />
                    )}
                    <div className={placeSearchFailed ? 'button-row' : 'address-editor-actions'}>
                      <button
                        className="secondary"
                        onClick={() => {
                          setAddressEditing(false);
                          setAddressQuery(draft.originAddress);
                          setPendingAddress(null);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      {placeSearchFailed && (
                        <button
                          disabled={geocoding || addressQuery.trim().length === 0}
                          onClick={lookUpAddress}
                          type="button"
                        >
                          Look up
                        </button>
                      )}
                    </div>
                    {pendingAddress && (
                      <div className="address-confirm">
                        <strong>{pendingAddress.formattedAddress}</strong>
                        <p>Using this location recenters the boundary. Excluded areas stay put.</p>
                        <button onClick={confirmAddress} type="button">
                          Use this address
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <fieldset className="region-settings-row boundary-shape-control">
                <legend>Boundary shape</legend>
                <div>
                  {(['circle', 'square'] as const).map((shape) => (
                    <button
                      aria-pressed={draft.boundaryShape === shape}
                      className={draft.boundaryShape === shape ? 'active' : ''}
                      key={shape}
                      onClick={() => setDraft((current) => ({ ...current, boundaryShape: shape }))}
                      type="button"
                    >
                      {shape === 'circle' ? 'Circle' : 'Square'}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="region-settings-row radius-control">
                <div className="section-row">
                  <h2>Boundary distance</h2>
                  <label>
                    <span className="sr-only">Boundary distance in miles</span>
                    <input
                      aria-describedby={radiusError ? 'radius-error' : undefined}
                      max="5"
                      min="1"
                      onChange={(event) => {
                        setRadiusInput(event.target.value);
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 1 && value <= 5) {
                          setDraft((current) => ({ ...current, radiusMiles: value }));
                        }
                      }}
                      step="0.1"
                      type="number"
                      value={radiusInput}
                    />
                    <span>miles</span>
                  </label>
                </div>
                <input
                  aria-label="Region boundary distance"
                  max="5"
                  min="1"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRadiusInput(event.target.value);
                    setDraft((current) => ({ ...current, radiusMiles: value }));
                  }}
                  step="0.1"
                  type="range"
                  value={draft.radiusMiles}
                />
                <div className="range-labels">
                  <span>1 mile</span>
                  <span>5 miles</span>
                </div>
                {radiusError && (
                  <p className="field-error" id="radius-error">
                    {radiusError}
                  </p>
                )}
              </div>
            </section>
          </details>

          <div className="territory-review-tools">
            <details
              className="review-disclosure apartment-section"
              open={openReviewSection === 'apartments'}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is the native disclosure control. */}
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  transitionReviewSection(openReviewSection === 'apartments' ? null : 'apartments');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    transitionReviewSection(
                      openReviewSection === 'apartments' ? null : 'apartments',
                    );
                  }
                }}
              >
                <span className="review-disclosure-summary-copy">
                  <strong className="review-disclosure-title">Apartments</strong>
                  <small className="review-disclosure-meta">
                    {apartmentSummary.confirmedComplexes}{' '}
                    {apartmentSummary.confirmedComplexes === 1 ? 'complex' : 'complexes'}
                    <span aria-hidden="true"> &middot; </span>
                    {apartmentSummary.ungroupedBuildings} ungrouped{' '}
                    {apartmentSummary.ungroupedBuildings === 1 ? 'building' : 'buildings'}
                  </small>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="review-disclosure-body">
                {groupingApartment ? (
                  <div className="apartment-grouping-panel">
                    <strong>
                      {groupingApartment.siteId ? 'Edit apartment buildings' : 'Group buildings'}
                    </strong>
                    <p>
                      Select one or more apartment markers on the map. Only the selected buildings
                      will belong to this complex.
                    </p>
                    <span>
                      {groupingApartment.memberIds.length}{' '}
                      {groupingApartment.memberIds.length === 1 ? 'building' : 'buildings'} selected
                    </span>
                    <div className="apartment-grouping-actions">
                      <button onClick={() => setGroupingApartment(null)} type="button">
                        Cancel
                      </button>
                      <button
                        disabled={
                          savingApartmentId !== null || groupingApartment.memberIds.length === 0
                        }
                        onClick={() =>
                          void saveApartmentMembership({
                            id: groupingApartment.siteId,
                            memberIds: groupingApartment.memberIds,
                          })
                        }
                        type="button"
                      >
                        Save grouping
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="apartment-grouping-start"
                      onClick={() => {
                        setApartmentSelection(null);
                        setGroupingApartment({ siteId: null, memberIds: [] });
                      }}
                      type="button"
                    >
                      Group apartment buildings
                    </button>
                    <label className="apartment-search" htmlFor="apartment-complex-search">
                      Find an apartment site
                      <input
                        id="apartment-complex-search"
                        onChange={(event) => {
                          setApartmentSearch(event.target.value);
                          if (selectedApartment) setApartmentSelection(null);
                        }}
                        placeholder="Search address or nearby street"
                        type="search"
                        value={apartmentSearch}
                      />
                    </label>
                    {selectedApartment ? (
                      <>
                        <button
                          className="reconciliation-back-link"
                          onClick={() => {
                            setApartmentSelection(null);
                            setApartmentSearch('');
                          }}
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                          </svg>
                          Back to list
                        </button>
                        <div className="apartment-card apartment-site-card">
                          <div className="apartment-site-heading">
                            <strong>
                              {selectedApartment.name ??
                                selectedApartment.address ??
                                'Apartment site'}
                            </strong>
                            <span className={selectedApartment.packetReady ? 'ready' : undefined}>
                              {selectedApartment.packetReady ? 'Packet ready' : 'Needs setup'}
                            </span>
                          </div>
                          <small>
                            {selectedApartmentBuildingCount} apartment building
                            {selectedApartmentBuildingCount === 1 ? '' : 's'}
                            {selectedApartmentUnitCount > 0
                              ? ` · ${selectedApartmentUnitCount} imported unit ${selectedApartmentUnitCount === 1 ? 'address' : 'addresses'}`
                              : ''}
                            {!selectedApartment.address && selectedApartmentOption?.nearbyStreet
                              ? ` · Near ${selectedApartmentOption.nearbyStreet}`
                              : ''}
                          </small>
                          <button
                            className="apartment-edit-buildings"
                            onClick={() =>
                              setGroupingApartment({
                                siteId: selectedApartment.id,
                                memberIds: selectedApartment.members.map(({ id }) => id),
                              })
                            }
                            type="button"
                          >
                            Edit buildings
                          </button>
                          <div className="apartment-configuration-fields">
                            <label>
                              Complex name <small>Optional</small>
                              <input
                                defaultValue={selectedApartment.name ?? ''}
                                disabled={apartmentConfigurationSaving}
                                key={`${selectedApartment.id}:name`}
                                onBlur={(event) => {
                                  const name = event.target.value.trim() || null;
                                  if (name !== selectedApartment.name)
                                    void saveApartmentConfiguration(
                                      apartmentConfiguration(selectedApartment, { name }),
                                    );
                                }}
                                placeholder="Apartment complex name"
                              />
                            </label>
                            <label>
                              Primary entrance or address
                              <input
                                defaultValue={selectedApartment.address ?? ''}
                                disabled={apartmentConfigurationSaving}
                                key={`${selectedApartment.id}:address`}
                                onBlur={(event) => {
                                  const address = event.target.value.trim() || null;
                                  if (address !== selectedApartment.address)
                                    void saveApartmentConfiguration(
                                      apartmentConfiguration(selectedApartment, {
                                        address,
                                        addressConfirmed: false,
                                      }),
                                    );
                                }}
                                placeholder="Enter a usable starting address"
                              />
                            </label>
                            <label>
                              Tract quantity
                              <input
                                defaultValue={selectedApartment.tractCount ?? ''}
                                disabled={apartmentConfigurationSaving}
                                key={`${selectedApartment.id}:tracts`}
                                min="1"
                                onBlur={(event) => {
                                  const value = Number(event.target.value);
                                  const tractCount =
                                    Number.isSafeInteger(value) && value >= 1 ? value : null;
                                  if (tractCount !== selectedApartment.tractCount)
                                    void saveApartmentConfiguration(
                                      apartmentConfiguration(selectedApartment, { tractCount }),
                                    );
                                }}
                                placeholder="Enter tract count"
                                type="number"
                              />
                            </label>
                            <label>
                              Access
                              <select
                                disabled={apartmentConfigurationSaving}
                                onChange={(event) =>
                                  void saveApartmentConfiguration(
                                    apartmentConfiguration(selectedApartment, {
                                      accessStatus: event.target
                                        .value as ApartmentSite['accessStatus'],
                                    }),
                                  )
                                }
                                value={selectedApartment.accessStatus}
                              >
                                <option value="unknown">Unknown</option>
                                <option value="open">Open</option>
                                <option value="restricted">Restricted</option>
                              </select>
                            </label>
                          </div>
                          <div className="apartment-readiness-checks">
                            <label>
                              <input
                                checked={selectedApartment.groupingConfirmed}
                                disabled={apartmentConfigurationSaving}
                                onChange={(event) =>
                                  void saveApartmentConfiguration(
                                    apartmentConfiguration(selectedApartment, {
                                      groupingConfirmed: event.target.checked,
                                    }),
                                  )
                                }
                                type="checkbox"
                              />
                              Building grouping confirmed
                            </label>
                            <label>
                              <input
                                checked={selectedApartment.addressConfirmed}
                                disabled={
                                  apartmentConfigurationSaving || !selectedApartment.address
                                }
                                onChange={(event) =>
                                  void saveApartmentConfiguration(
                                    apartmentConfiguration(selectedApartment, {
                                      addressConfirmed: event.target.checked,
                                    }),
                                  )
                                }
                                type="checkbox"
                              />
                              Primary entrance confirmed
                            </label>
                          </div>
                          <label className="apartment-inclusion-control">
                            <input
                              checked={selectedApartment.includedInPackets}
                              disabled={
                                apartmentConfigurationSaving || !selectedApartment.packetReady
                              }
                              onChange={(event) =>
                                void saveApartmentConfiguration(
                                  apartmentConfiguration(selectedApartment, {
                                    includedInPackets: event.target.checked,
                                  }),
                                )
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>Include in packet generation</strong>
                              <small>Creates one packet for the complete complex.</small>
                            </span>
                          </label>
                          {!selectedApartment.packetReady && (
                            <small>
                              Confirm the grouping, entrance, tract quantity, and access first.
                            </small>
                          )}
                          {savingApartmentId === selectedApartment.id && (
                            <span aria-live="polite" className="apartment-inclusion-saving">
                              Saving…
                            </span>
                          )}
                        </div>
                      </>
                    ) : apartmentSearchResults.length > 0 ? (
                      <ul className="apartment-search-results">
                        {apartmentSearchResults.map(
                          ({ apartment, label, nearbyStreet, disambiguator }) => (
                            <li key={apartment.id}>
                              <button
                                aria-label={label}
                                onClick={() => selectApartment(apartment.id, 'selector')}
                                type="button"
                              >
                                <strong>
                                  {apartment.name ??
                                    apartment.address ??
                                    `Address unavailable near ${nearbyStreet ?? 'mapped roads'}`}
                                </strong>
                                <span>
                                  {apartment.includedInPackets
                                    ? 'Included'
                                    : apartment.packetReady
                                      ? 'Packet ready'
                                      : 'Needs setup'}
                                  {disambiguator ? ` · ${disambiguator}` : ''}
                                </span>
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="empty-state">
                        No matching apartment sites. Try a nearby street or select a map marker.
                      </p>
                    )}
                  </>
                )}
                {apartmentSaveFailure && (
                  <OperationStatus
                    action={
                      apartmentSaveFailure.recovery === 'reload' ? (
                        <button onClick={() => window.location.reload()} type="button">
                          Reload to verify
                        </button>
                      ) : (
                        <button
                          onClick={() => void retryApartmentMutation(apartmentSaveFailure)}
                          type="button"
                        >
                          Try again
                        </button>
                      )
                    }
                    detail={apartmentSaveFailure.message}
                    headline={
                      apartmentSaveFailure.recovery === 'reload'
                        ? 'Could not confirm apartment save'
                        : 'Apartment changes were not saved'
                    }
                    tone="error"
                  />
                )}
              </div>
            </details>

            <details
              className="review-disclosure road-selection-section"
              open={openReviewSection === 'roads'}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is the native disclosure control. */}
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  transitionReviewSection(openReviewSection === 'roads' ? null : 'roads');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    transitionReviewSection(openReviewSection === 'roads' ? null : 'roads');
                  }
                }}
              >
                <span className="review-disclosure-summary-copy">
                  <strong className="review-disclosure-title">Road segments</strong>
                  <small className="review-disclosure-meta">
                    {live.totals.eligibleSegments.toLocaleString('en-US')} eligible segments
                    <span aria-hidden="true"> &middot; </span>
                    {live.totals.eligibleHomes.toLocaleString('en-US')} tracts
                  </small>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="review-disclosure-body">
                <label className="road-segment-search">
                  Find road segments
                  <input
                    onChange={(event) => setRoadSearch(event.target.value)}
                    placeholder="Search street names"
                    type="search"
                    value={roadSearch}
                  />
                </label>
                <p className="section-help road-review-help">
                  Search by street name, or select roads directly on the map. Shift-click adds or
                  removes roads; Shift-drag selects road segments.
                </p>
                {normalizedRoadSearch && (
                  <div className="road-search-results">
                    {roadSearchResults.length > 0 ? (
                      roadSearchResults.map((road) => {
                        const included = road.segments.filter(
                          (segment) => segment.active && !segment.manuallyExcluded,
                        ).length;
                        const excluded = road.segments.filter(
                          (segment) => segment.manuallyExcluded,
                        ).length;
                        const hidden = road.segments.length - included - excluded;
                        const status = [
                          included && `${included} included`,
                          excluded && `${excluded} excluded`,
                          hidden && `${hidden} hidden`,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const estimatedTracts = road.segments.reduce(
                          (total, segment) => total + segment.estimatedHomes,
                          0,
                        );
                        return (
                          <button
                            aria-pressed={road.segments.every((segment) =>
                              selectedIdSet.has(segment.id),
                            )}
                            key={road.roadGroupId}
                            onClick={(event) =>
                              selectSegments(
                                road.segments.map(({ id }) => id),
                                event.shiftKey,
                                'search',
                              )
                            }
                            type="button"
                          >
                            <strong>{road.streetName}</strong>
                            <span>
                              {status} · {road.segments.length} section
                              {road.segments.length === 1 ? '' : 's'} · {estimatedTracts} estimated
                              tract{estimatedTracts === 1 ? '' : 's'}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="empty-state">No matching road segments.</p>
                    )}
                  </div>
                )}
                <div className="road-section-tools">
                  <label className="hidden-roads-toggle">
                    <input
                      checked={showHiddenRoads}
                      onChange={(event) => {
                        const show = event.target.checked;
                        setShowHiddenRoads(show);
                        if (!show) {
                          const activeIds = new Set(
                            live.segments
                              .filter((segment) => segment.active)
                              .map((segment) => segment.id),
                          );
                          setSelectedSegmentIds((current) =>
                            current.filter((id) => activeIds.has(id)),
                          );
                        }
                      }}
                      type="checkbox"
                    />
                    Show hidden roads
                  </label>
                </div>
                {selectedSegments.length > 0 ? (
                  <div className="road-selection-tray">
                    <div className="section-row">
                      <h3>
                        {selectedSegments.length} segment
                        {selectedSegments.length === 1 ? '' : 's'} selected
                      </h3>
                      <button
                        className="text-button"
                        onClick={() => setSelectedSegmentIds([])}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="road-selection-summary">
                      {includedSelected.length > 0 && (
                        <span>
                          <i className="included" /> {includedSelected.length} included
                        </span>
                      )}
                      {excludedSelected.length > 0 && (
                        <span>
                          <i className="excluded" /> {excludedSelected.length} excluded
                        </span>
                      )}
                      {hiddenSelected.length > 0 && (
                        <span>
                          <i className="hidden-road" /> {hiddenSelected.length} hidden
                        </span>
                      )}
                    </div>
                    <div className="road-selection-actions">
                      {includedSelected.length > 0 && (
                        <button
                          onClick={() => {
                            setDraft((current) =>
                              setSegmentsExcluded(
                                current,
                                includedSelected.map(({ id }) => id),
                                true,
                              ),
                            );
                            setNotice(
                              'Selected segments excluded in this draft. Save changes to keep it.',
                            );
                          }}
                          type="button"
                        >
                          Exclude included
                        </button>
                      )}
                      {excludedSelected.length > 0 && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setDraft((current) =>
                              setSegmentsExcluded(
                                current,
                                excludedSelected.map(({ id }) => id),
                                false,
                              ),
                            );
                            setNotice(
                              'Selected segments restored in this draft. Save changes to keep it.',
                            );
                          }}
                          type="button"
                        >
                          Restore excluded
                        </button>
                      )}
                      {hiddenSelected.length > 0 && (
                        <button
                          onClick={() => {
                            setDraft((current) =>
                              activateSegments(
                                current,
                                hiddenSelected.map(({ id }) => id),
                              ),
                            );
                            setNotice(
                              'Selected hidden segments activated in this draft. Save changes to keep it.',
                            );
                          }}
                          type="button"
                        >
                          Activate hidden
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
            {savedWorkspace.import.quality && (
              <details
                className="review-disclosure territory-data-quality"
                open={openReviewSection === 'quality'}
              >
                {/* biome-ignore lint/a11y/noStaticElementInteractions: summary is the native disclosure control. */}
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    transitionReviewSection(openReviewSection === 'quality' ? null : 'quality');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      transitionReviewSection(openReviewSection === 'quality' ? null : 'quality');
                    }
                  }}
                >
                  <span className="review-disclosure-summary-copy">
                    <strong className="review-disclosure-title">Data quality</strong>
                    <small className="review-disclosure-meta">
                      {savedWorkspace.import.quality.warnings.length} warning
                      {savedWorkspace.import.quality.warnings.length === 1 ? '' : 's'}
                    </small>
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="review-disclosure-body">
                  <p className="quality-impact">
                    Some streets need a quick map review before packet generation. Streetlight kept
                    them available so you can check unusual roads and building-heavy areas.
                  </p>
                  {savedWorkspace.import.quality.warnings.length > 0 && (
                    <div className="import-quality-warning">
                      <strong>Street data may be incomplete</strong>
                      <p>Review the map before generating the next packet batch.</p>
                    </div>
                  )}
                  <details className="quality-technical-details">
                    <summary>Technical details</summary>
                    <p>
                      Address match: {savedWorkspace.import.quality.assignedAddresses} of{' '}
                      {savedWorkspace.import.quality.totalAddresses} &middot;{' '}
                      {savedWorkspace.import.quality.inferredRoads} inferred road
                      {savedWorkspace.import.quality.inferredRoads === 1 ? '' : 's'}
                    </p>
                    <ul>
                      {savedWorkspace.import.quality.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              </details>
            )}
          </div>
        </div>

        <div className="sidebar-actions">
          {operationPlacement === 'surface' && saveStatus}
          {pendingLeave ? (
            <div className="territory-leave-prompt" role="alert">
              <strong>Save region changes before leaving?</strong>
              <p>Your draft will stay here until you choose what to do.</p>
              <div>
                <button
                  className="secondary"
                  disabled={leaveControlsDisabled}
                  onClick={onStay}
                  type="button"
                >
                  Stay
                </button>
                <button
                  className="secondary"
                  disabled={leaveControlsDisabled}
                  onClick={() => {
                    cancelChanges();
                    onDiscardAndLeave();
                  }}
                  type="button"
                >
                  Discard changes
                </button>
                <button
                  disabled={leaveControlsDisabled}
                  onClick={() => void saveChanges(true)}
                  type="button"
                >
                  {saveFailure?.recovery === 'retry' ? 'Try save again' : 'Save changes'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {!saving && !saveFailure && !backgroundImportComplete && (
                <p aria-live="polite">{notice}</p>
              )}
              {importRequired && !importing && (
                <p className="import-notice">Street data will refresh when saved.</p>
              )}
              <div>
                <button
                  className="secondary"
                  disabled={!hasUnsavedChanges || saving || verificationRequired}
                  onClick={cancelChanges}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={!canSave || saving || verificationRequired || Boolean(radiusError)}
                  onClick={() => void saveChanges()}
                  type="button"
                >
                  {saving
                    ? 'Saving…'
                    : saveFailure?.recovery === 'retry'
                      ? 'Try save again'
                      : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
      {operationPlacement === 'global' && saveStatus}
    </>
  );
}
