'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerritoryWorkspace } from '@/lib/database';
import { loadGoogleMaps } from '@/lib/google-maps-browser';
import {
  activateSegments,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  setSegmentsExcluded,
  territoryDraftFromWorkspace,
} from '@/lib/territory-client';
import { parseTerritoryDraft } from '@/lib/territory-draft';
import { type Position, pointInsideTerritoryBoundary } from '@/lib/territory-geometry';
import { needsTerritoryImport } from '@/lib/territory-import';
import type { TerritoryImportJob, TerritoryImportStage } from '@/lib/territory-import-job';
import {
  type ApartmentSelectionSource,
  apartmentOptionLabel,
  createApartmentSelection,
} from '@/lib/territory-map-style';
import { OpenTerritoryMap } from './OpenTerritoryMap';
import { OperationStatus } from './OperationStatus';
import { isTerritoryWorkspacePayload, territoryLeaveControlsDisabled } from './operation-state';
import { StreetlightSelect } from './StreetlightSelect';
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

const importStageLabels: Record<TerritoryImportStage, string> = {
  queued: 'Street data refresh queued',
  downloading_streets: 'Downloading streets and addresses',
  downloading_buildings: 'Downloading building footprints',
  matching: 'Matching homes to streets',
  preparing: 'Preparing territory data',
  saving: 'Saving territory',
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
  const [boxSelectionArmed, setBoxSelectionArmed] = useState(false);
  const [roadSearch, setRoadSearch] = useState('');
  const [apartmentSelection, setApartmentSelection] = useState<{
    id: string;
    source: ApartmentSelectionSource;
  } | null>(null);
  const [radiusInput, setRadiusInput] = useState(String(initialDraft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressQuery, setAddressQuery] = useState(initialDraft.originAddress);
  const [pendingAddress, setPendingAddress] = useState<PendingAddress | null>(null);
  const [placeSearchFailed, setPlaceSearchFailed] = useState(!mapsApiKey);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importJob, setImportJob] = useState<TerritoryImportJob | null>(null);
  const [saveFailure, setSaveFailure] = useState<TerritorySaveFailure | null>(null);
  const [backgroundImportComplete, setBackgroundImportComplete] = useState(false);
  const [notice, setNotice] = useState('Saved territory loaded.');
  const addressInputRef = useRef<HTMLInputElement>(null);
  const placeSearchRef = useRef<HTMLDivElement>(null);

  const live = useMemo(
    () => deriveTerritory(savedWorkspace.segments, draft),
    [draft, savedWorkspace.segments],
  );
  const liveApartments = useMemo(() => {
    const statuses = new Map(
      (draft.apartmentStatuses ?? []).map(({ id, reviewStatus }) => [id, reviewStatus]),
    );
    return savedWorkspace.apartmentComplexes.map((apartment) => ({
      ...apartment,
      reviewStatus: statuses.get(apartment.id) ?? apartment.reviewStatus,
      withinBoundary: pointInsideTerritoryBoundary(
        apartment.position,
        draft.center,
        draft.radiusMiles,
        draft.boundaryShape,
      ),
    }));
  }, [draft, savedWorkspace.apartmentComplexes]);
  const hasUnsavedChanges = hasUnsavedTerritoryChanges(savedDraft, draft);
  const isDirty = hasUnsavedChanges;
  const importRequired = needsTerritoryImport(savedWorkspace.import, draft);
  const canSave = isDirty || importRequired;
  const verificationRequired = saveFailure?.recovery === 'reload';
  const leaveControlsDisabled = territoryLeaveControlsDisabled({
    saving: saving || importing,
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
    ? live.segments
        .filter(
          (segment) =>
            segment.withinBoundary &&
            (segment.active || segment.manuallyExcluded || showHiddenRoads) &&
            (segment.streetName || 'Unnamed road')
              .toLocaleLowerCase()
              .includes(normalizedRoadSearch),
        )
        .sort((left, right) =>
          (left.streetName || 'Unnamed road').localeCompare(right.streetName || 'Unnamed road'),
        )
        .slice(0, 20)
    : [];
  const selectedApartment =
    liveApartments.find(
      (apartment) => apartment.withinBoundary && apartment.id === apartmentSelection?.id,
    ) ?? null;

  const acceptSavedWorkspace = useCallback(
    async (result: TerritoryWorkspace, imported: boolean) => {
      const nextDraft = territoryDraftFromWorkspace(result);
      setSavedWorkspace(result);
      setDraft(nextDraft);
      setSavedDraft(structuredClone(nextDraft));
      setRadiusInput(String(nextDraft.radiusMiles));
      setSelectedSegmentIds([]);
      setBoxSelectionArmed(false);
      setApartmentSelection(null);
      setSaving(false);
      setImporting(false);
      setBackgroundImportComplete(imported);
      try {
        await onSaved(result, imported);
        setNotice(imported ? 'Street data refreshed.' : 'Territory changes saved.');
      } catch {
        setNotice('Territory saved, but coverage could not refresh. Reload the page to retry.');
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

  const selectSegments = useCallback((segmentIds: string[], additive: boolean) => {
    setSelectedSegmentIds((current) => {
      if (!additive) return [...new Set(segmentIds)];
      const next = new Set(current);
      for (const id of segmentIds) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
    setApartmentSelection(null);
  }, []);

  const selectApartment = useCallback((apartmentId: string, source: ApartmentSelectionSource) => {
    setApartmentSelection(createApartmentSelection(apartmentId, source));
    setSelectedSegmentIds([]);
    setBoxSelectionArmed(false);
  }, []);

  function cancelChanges() {
    setDraft(structuredClone(savedDraft));
    setRadiusInput(String(savedDraft.radiusMiles));
    setSelectedSegmentIds([]);
    setBoxSelectionArmed(false);
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
        if (!job) throw new Error('Invalid territory import response');
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
              : 'Streetlight could not confirm whether the territory changes were saved. Reload to verify before trying again.';
        const recovery = response.status < 500 ? 'retry' : 'reload';
        setSaveFailure({ message, recovery, willImport });
        setNotice(message);
        setSaving(false);
        setImporting(false);
        return;
      }
      if (!isTerritoryWorkspacePayload(body)) {
        throw new Error('Invalid saved territory response');
      }
      await acceptSavedWorkspace(body, false);
      if (leaveAfterSave && !leaveWhileImportRuns) onSaveAndLeave();
    } catch {
      const message = willImport
        ? 'Streetlight could not confirm whether street data preparation started. Reload to verify before trying again.'
        : 'Streetlight could not confirm whether the territory changes were saved. Reload to verify before trying again.';
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
          throw new Error('Could not load territory import');
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
            throw new Error('Saved territory is unavailable');
          }
          await acceptSavedWorkspace(workspace, true);
          return;
        }

        const message =
          job.error ??
          (job.status === 'interrupted'
            ? 'Street data preparation was interrupted. Your previous saved territory is still active.'
            : 'Street data preparation failed. Your previous saved territory is still active.');
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
                Return to Territory Setup
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
                  : `${saveFailure.message} Your previous saved territory is still active.`
                : `${saveFailure.message} Your draft is still here.`
            : backgroundImportComplete
              ? 'The street import finished and the territory was saved. Reload if map totals have not refreshed.'
              : importing
                ? setupRequired
                  ? 'This usually takes around two minutes. You can safely refresh this page.'
                  : 'This usually takes around two minutes. Your saved territory remains active, and you can keep working.'
                : 'Your draft stays here until Streetlight confirms the save.'
        }
        headline={
          saveFailure
            ? saveFailure.recovery === 'reload'
              ? 'Could not confirm territory save'
              : saveFailure.willImport
                ? 'Street import did not finish'
                : 'Territory changes were not saved'
            : backgroundImportComplete
              ? 'Street data refreshed'
              : importing
                ? importStageLabels[importJob?.stage ?? 'queued']
                : 'Saving territory changes'
        }
        placement={operationPlacement}
        tone={saveFailure ? 'error' : backgroundImportComplete ? 'success' : 'busy'}
      />
    ) : null;

  return (
    <>
      <OpenTerritoryMap
        active={active}
        apartmentComplexes={liveApartments}
        apartmentSelectionSource={apartmentSelection?.source ?? null}
        boundaryShape={draft.boundaryShape}
        boxSelectionArmed={boxSelectionArmed}
        center={draft.center}
        map={map}
        mutationLocked={leaveControlsDisabled}
        onBoxSelectionComplete={() => setBoxSelectionArmed(false)}
        onSelectApartment={(id) => selectApartment(id, 'map')}
        onSelectSegments={selectSegments}
        radiusMiles={draft.radiusMiles}
        segments={live.segments}
        selectedApartmentId={selectedApartment?.id ?? null}
        selectedApartmentPosition={selectedApartment?.position ?? null}
        selectedSegmentIds={selectedSegmentIds}
        showHiddenRoads={showHiddenRoads}
      />
      {active &&
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
            <div className="map-selection-tools">
              <button
                aria-pressed={boxSelectionArmed}
                className={boxSelectionArmed ? 'active' : undefined}
                onClick={() => setBoxSelectionArmed((armed) => !armed)}
                type="button"
              >
                {boxSelectionArmed ? 'Drag over roads' : 'Select area'}
              </button>
              <span>
                {boxSelectionArmed ? 'Drag a box on the map' : 'Shift-drag also selects an area'}
              </span>
            </div>{' '}
          </>,
          overlayRoot,
        )}

      <aside
        aria-busy={saving || importing}
        className="territory-sidebar tool-sidebar"
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
          <section className="territory-basics-section">
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

            <fieldset className="boundary-shape-control">
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

            <div className="radius-control">
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
                aria-label="Territory boundary distance"
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

            <div className="territory-summary">
              <div>
                <strong>{live.totals.eligibleHomes}</strong>
                <span>Eligible tracts</span>
              </div>
              <div>
                <strong>{live.totals.eligibleSegments}</strong>
                <span>Eligible segments</span>
              </div>
            </div>
            {savedWorkspace.import.quality && (
              <p>
                Address match: {savedWorkspace.import.quality.assignedAddresses} of{' '}
                {savedWorkspace.import.quality.totalAddresses} ·{' '}
                {savedWorkspace.import.quality.inferredRoads} inferred road(s)
              </p>
            )}
          </section>

          <section className="territory-review-intro">
            <h2>Review territory data</h2>
            <p>
              Correct apartment status, road eligibility, and excluded areas when the imported map
              needs adjustment.
            </p>
          </section>
          <div className="territory-review-tools">
            <section className="apartment-section">
              <div className="section-row">
                <h2>Apartment complex</h2>
                <span>{liveApartments.filter(({ withinBoundary }) => withinBoundary).length}</span>
              </div>
              <label className="apartment-selector" htmlFor="apartment-complex">
                Apartment complex
                <StreetlightSelect
                  ariaLabel="Apartment complex"
                  id="apartment-complex"
                  onValueChange={(value) => {
                    if (value) selectApartment(value, 'selector');
                    else setApartmentSelection(null);
                  }}
                  options={[
                    { label: 'Choose a complex', value: '' },
                    ...liveApartments
                      .filter(({ withinBoundary }) => withinBoundary)
                      .map((apartment) => ({
                        label: apartmentOptionLabel(apartment),
                        value: apartment.id,
                      })),
                  ]}
                  value={selectedApartment?.id ?? ''}
                />
              </label>
              {selectedApartment ? (
                <div className="apartment-card">
                  <strong>{selectedApartment.address ?? 'Address unavailable'}</strong>
                  <span>Estimated tracts: {selectedApartment.estimatedTracts}</span>
                  <small>
                    {selectedApartment.evidence.apartmentBuilding
                      ? selectedApartment.evidence.distinctUnits > 0
                        ? `Overture apartment building · ${selectedApartment.evidence.distinctUnits} distinct unit addresses`
                        : 'Overture apartment building · footprint estimate'
                      : `${selectedApartment.evidence.distinctUnits} distinct unit addresses`}
                  </small>
                  <fieldset>
                    <legend>Outreach status</legend>
                    {(
                      [
                        ['needs_review', 'Needs review'],
                        ['ready', 'Ready'],
                        ['deferred', 'Deferred'],
                      ] as const
                    ).map(([reviewStatus, label]) => (
                      <label key={reviewStatus}>
                        <input
                          checked={selectedApartment.reviewStatus === reviewStatus}
                          disabled={reviewStatus === 'ready' && !selectedApartment.address}
                          name={`apartment-${selectedApartment.id}`}
                          onChange={() => {
                            setDraft((current) => ({
                              ...current,
                              apartmentStatuses: (current.apartmentStatuses ?? []).map(
                                (apartment) =>
                                  apartment.id === selectedApartment.id
                                    ? { ...apartment, reviewStatus }
                                    : apartment,
                              ),
                            }));
                            setNotice(`${label} selected in this draft. Save changes to keep it.`);
                          }}
                          type="radio"
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  {!selectedApartment.address && (
                    <small>A starting address is required before this complex can be ready.</small>
                  )}
                </div>
              ) : (
                <p className="empty-state">Choose a complex or select its map marker.</p>
              )}
            </section>

            <section className="road-selection-section">
              <div className="section-row">
                <h2>Road segments</h2>
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
              <p className="section-help">
                Click a road. Shift-click adds or removes one; Shift-drag selects an area.
              </p>
              <label className="road-segment-search">
                Find road segments
                <input
                  onChange={(event) => setRoadSearch(event.target.value)}
                  placeholder="Search street names"
                  type="search"
                  value={roadSearch}
                />
              </label>
              {normalizedRoadSearch && (
                <div className="road-search-results">
                  {roadSearchResults.length > 0 ? (
                    roadSearchResults.map((segment) => {
                      const status = !segment.active
                        ? 'Hidden'
                        : segment.manuallyExcluded
                          ? 'Excluded'
                          : 'Included';
                      return (
                        <button
                          aria-pressed={selectedIdSet.has(segment.id)}
                          key={segment.id}
                          onClick={(event) => selectSegments([segment.id], event.shiftKey)}
                          type="button"
                        >
                          <strong>{segment.streetName || 'Unnamed road'}</strong>
                          <span>
                            {status} · {segment.estimatedHomes} estimated tract
                            {segment.estimatedHomes === 1 ? '' : 's'}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="empty-state">No matching road segments.</p>
                  )}
                </div>
              )}
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
              ) : (
                <p className="empty-state">Select roads on the map or search by street name.</p>
              )}
            </section>
          </div>
          {(savedWorkspace.import.quality?.warnings.length ?? 0) > 0 && (
            <div className="import-quality-warning" role="alert">
              <strong>Street data may be incomplete</strong>
              <ul>
                {savedWorkspace.import.quality?.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="sidebar-actions">
          {operationPlacement === 'surface' && saveStatus}
          {pendingLeave ? (
            <div className="territory-leave-prompt" role="alert">
              <strong>Save territory changes before leaving?</strong>
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
