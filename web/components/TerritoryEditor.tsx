'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { coverageRoads } from '@/lib/coverage';
import { loadGoogleMaps } from '@/lib/google-maps-browser';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import { APARTMENTS_ENABLED } from '@/lib/product-capabilities';
import type { RegionSetupReadyView, RegionSetupWorkflow } from '@/lib/region-setup-workflow';
import { apartmentSiteSummary, territoryRadiusMilesText } from '@/lib/territory-client';
import { type Position, pointInsideTerritoryBoundary } from '@/lib/territory-geometry';
import type { TerritoryImportStage } from '@/lib/territory-import-job';
import {
  type ApartmentSelectionSource,
  apartmentReviewOptions,
  createApartmentSelection,
} from '@/lib/territory-map-style';
import type {
  ApartmentSite,
  ApartmentSiteConfigurationInput,
  ApartmentSiteMembershipInput,
} from '@/lib/territory-workspace';
import { OpenTerritoryMap } from './OpenTerritoryMap';
import { OperationStatus } from './OperationStatus';
import { setupToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

type PendingAddress = {
  formattedAddress: string;
  center: Position;
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

export function TerritoryEditor({
  active,
  lifecycle,
  mapVisible,
  mapsApiKey,
  overlayRoot,
  onReturnToSetup,
  onStay,
  onViewChange,
  pendingLeave,
  view,
  workflow,
}: {
  active: boolean;
  lifecycle: MapOverlayLifecycle | null;
  mapVisible: boolean;
  mapsApiKey: string;
  overlayRoot: HTMLDivElement | null;
  onReturnToSetup: () => void;
  onStay: () => void;
  onViewChange: (view: 'territory' | 'printouts') => void;
  pendingLeave: boolean;
  view: RegionSetupReadyView;
  workflow: RegionSetupWorkflow;
}) {
  const savedWorkspace = view.accepted;
  const draft = view.draft;
  const live = view.displayed;
  const setupRequired = view.setupRequired;
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
  const [radiusInput, setRadiusInput] = useState(territoryRadiusMilesText(draft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [openReviewSection, setOpenReviewSection] = useState<ReviewSection | null>(
    setupRequired ? 'region' : 'roads',
  );
  const [addressQuery, setAddressQuery] = useState(draft.originAddress);
  const [placeSearchFailed, setPlaceSearchFailed] = useState(!mapsApiKey);
  const [notice, setNotice] = useState(view.notice);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const placeSearchRef = useRef<HTMLDivElement>(null);
  const reviewSectionTransitionRef = useRef<number | null>(null);

  const pendingAddress =
    view.addressLookup.kind === 'candidate' ? view.addressLookup.candidate : null;
  const geocoding = view.addressLookup.kind === 'looking';
  const saving = view.operation.kind === 'saving';
  const importing = view.operation.kind === 'importing';
  const importStage = view.operation.kind === 'importing' ? view.operation.stage : 'queued';
  const saveFailure =
    view.operation.kind === 'failed'
      ? {
          message: view.operation.message,
          recovery: view.operation.recovery,
          willImport: view.operation.target === 'import',
        }
      : null;
  const backgroundImportComplete = view.operation.kind === 'completed';
  const savingApartmentId = view.apartment?.savingId ?? null;
  const apartmentSaveFailure = view.apartment?.failure ?? null;
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
  const hasUnsavedChanges = view.dirty;
  const importRequired = view.importRequired;
  const canSave = view.canSave;
  const leaveControlsDisabled = view.mutationLocked;
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

  useEffect(() => {
    setRadiusInput(territoryRadiusMilesText(savedWorkspace.radiusMiles));
    setAddressQuery(savedWorkspace.originAddress);
    setSelectedSegmentIds([]);
    setRoadFocusRequest(null);
    setBoxSelectionArmed(false);
    setApartmentSearch('');
    setApartmentSelection(null);
  }, [savedWorkspace]);

  useEffect(() => setNotice(view.notice), [view.notice]);

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
        autocomplete.addEventListener('input', () =>
          workflow.edit({ kind: 'address-candidate', candidate: null }),
        );
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
            workflow.edit({ kind: 'address-candidate', candidate: nextAddress });
            setNotice('Address found. Confirm the new church location.');
          } catch {
            workflow.edit({ kind: 'address-candidate', candidate: null });
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
  }, [addressEditing, mapsApiKey, workflow]);

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
    workflow.discard('stay');
    setRadiusInput(territoryRadiusMilesText(savedWorkspace.radiusMiles));
    setSelectedSegmentIds([]);
    setRoadFocusRequest(null);
    setBoxSelectionArmed(false);
    setApartmentSearch('');
    setApartmentSelection(null);
    setAddressEditing(false);
    workflow.edit({ kind: 'address-candidate', candidate: null });
    setNotice('Unsaved changes discarded.');
  }

  async function lookUpAddress() {
    setNotice('Looking up address…');
    const result = await workflow.resolveAddress(addressQuery);
    setNotice(result.ok ? 'Address found. Confirm the new church location.' : result.message);
  }

  async function saveApartmentConfiguration(input: ApartmentSiteConfigurationInput) {
    await workflow.apartments?.saveConfiguration(input);
  }

  async function saveApartmentMembership(input: ApartmentSiteMembershipInput) {
    const selectedId = await workflow.apartments?.saveMembership(input);
    if (selectedId) {
      setGroupingApartment(null);
      setApartmentSelection(createApartmentSelection(selectedId, 'map'));
    }
  }

  function confirmAddress() {
    if (!pendingAddress) {
      return;
    }
    workflow.edit({
      kind: 'location',
      originAddress: pendingAddress.formattedAddress,
      center: pendingAddress.center,
    });
    setAddressQuery(pendingAddress.formattedAddress);
    setAddressEditing(false);
    setNotice('Church location changed in this draft. Road adjustments stayed in place.');
  }

  async function saveChanges(leaveAfterSave = false) {
    await workflow.save(leaveAfterSave ? 'leave' : 'stay');
  }
  const operationPlacement = 'placement' in view.operation ? view.operation.placement : 'surface';
  const saveStatus =
    saving || importing || saveFailure || backgroundImportComplete ? (
      <OperationStatus
        action={
          saveFailure ? (
            saveFailure.recovery === 'reload' ? (
              <button onClick={() => void workflow.recover()} type="button">
                Reload to verify
              </button>
            ) : !active && !setupRequired ? (
              <button onClick={onReturnToSetup} type="button">
                Return to Region Setup
              </button>
            ) : undefined
          ) : backgroundImportComplete ? (
            <button onClick={() => workflow.dismiss()} type="button">
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
                ? importStageLabels[importStage]
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
        lifecycle={lifecycle}
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
        <div className="sidebar-scroll" inert={leaveControlsDisabled}>
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
                  {draft.originAddress.split(',')[0]} &middot;{' '}
                  {territoryRadiusMilesText(draft.radiusMiles)}-mile {draft.boundaryShape}
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
                        workflow.edit({ kind: 'address-candidate', candidate: null });
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
                          workflow.edit({ kind: 'address-candidate', candidate: null });
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
                          workflow.edit({ kind: 'address-candidate', candidate: null });
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
                      onClick={() => workflow.edit({ kind: 'shape', boundaryShape: shape })}
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
                          workflow.edit({ kind: 'radius', radiusMiles: value });
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
                    workflow.edit({ kind: 'radius', radiusMiles: value });
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
            {/* The apartment editor stays compiled for reactivation after the MVP. */}
            {!APARTMENTS_ENABLED && (
              <section className="apartment-coming-later">
                <strong className="review-disclosure-title">Apartments</strong>
                <small className="review-disclosure-meta">Coming later</small>
              </section>
            )}
            <details
              className="review-disclosure apartment-section"
              hidden={!APARTMENTS_ENABLED}
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
                    {apartmentSummary.siteCount}{' '}
                    {apartmentSummary.siteCount === 1 ? 'site' : 'sites'}
                    <span aria-hidden="true"> &middot; </span>
                    {apartmentSummary.includedCount} included
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
                            <span
                              className={
                                selectedApartment.includedInPackets ? 'included' : undefined
                              }
                            >
                              {selectedApartment.includedInPackets ? 'Included' : 'Not included'}
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
                              Primary entrance or address
                              <input
                                defaultValue={selectedApartment.address ?? ''}
                                disabled={apartmentConfigurationSaving}
                                key={`${selectedApartment.id}:address`}
                                onBlur={(event) => {
                                  const address = event.target.value.trim() || null;
                                  if (address !== selectedApartment.address)
                                    void saveApartmentConfiguration(
                                      apartmentConfiguration(selectedApartment, { address }),
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
                                    groupingConfirmed:
                                      event.target.checked || selectedApartment.groupingConfirmed,
                                    addressConfirmed:
                                      event.target.checked || selectedApartment.addressConfirmed,
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
                              Add a starting address, tract quantity, and access before including
                              this site.
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
                                  {apartment.includedInPackets ? 'Included' : 'Not included'}
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
                            workflow.edit({
                              kind: 'segments',
                              disposition: 'exclude',
                              ids: includedSelected.map(({ id }) => id),
                            });
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
                            workflow.edit({
                              kind: 'segments',
                              disposition: 'restore',
                              ids: excludedSelected.map(({ id }) => id),
                            });
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
                            workflow.edit({
                              kind: 'segments',
                              disposition: 'activate',
                              ids: hiddenSelected.map(({ id }) => id),
                            });
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
          {apartmentSaveFailure && (
            <OperationStatus
              action={
                apartmentSaveFailure.recovery === 'reload' ? (
                  <button onClick={() => void workflow.apartments?.retry()} type="button">
                    Reload to verify
                  </button>
                ) : (
                  <button
                    disabled={leaveControlsDisabled}
                    onClick={() => void workflow.apartments?.retry()}
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
                    workflow.discard('leave');
                    setAddressEditing(false);
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
                  disabled={!hasUnsavedChanges || leaveControlsDisabled}
                  onClick={cancelChanges}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={!canSave || leaveControlsDisabled || Boolean(radiusError)}
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
