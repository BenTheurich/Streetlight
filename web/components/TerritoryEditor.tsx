'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerritoryWorkspace } from '@/lib/database';
import {
  affectedByExclusion,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  moveVertexWithArrowKey,
  nextExclusionName,
  setSegmentExcluded,
  territoryDraftFromWorkspace,
} from '@/lib/territory-client';
import type { TerritoryDraftInput } from '@/lib/territory-draft';
import {
  closePolygon,
  type Position,
  pointInsideTerritoryBoundary,
  polygonIsSimple,
} from '@/lib/territory-geometry';
import { needsTerritoryImport } from '@/lib/territory-import';
import {
  type ApartmentSelectionSource,
  apartmentOptionLabel,
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

function VertexControls({
  points,
  onChange,
}: {
  points: Position[];
  onChange: (points: Position[]) => void;
}) {
  if (points.length === 0) {
    return null;
  }
  return (
    <fieldset className="vertex-controls">
      <legend>Vertices</legend>
      <div>
        {points.map((_, index) => (
          // Vertex order is its stable identity while coordinates move.
          <button
            aria-label={`Vertex ${index + 1}. Use arrow keys to move.`}
            // biome-ignore lint/suspicious/noArrayIndexKey: preserve focus while this vertex moves
            key={index}
            onKeyDown={(event) => {
              const next = moveVertexWithArrowKey(points, index, event.key);
              if (next !== points) {
                event.preventDefault();
                onChange(next);
              }
            }}
            type="button"
          >
            Vertex {index + 1}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function TerritoryEditor({
  active,
  initialData,
  map,
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
  overlayRoot: HTMLDivElement | null;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardAndLeave: () => void;
  onImportingChange: (importing: boolean) => void;
  onReturnToSetup: () => void;
  onSaved: (workspace: TerritoryWorkspace) => Promise<void>;
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
  const [mode, setMode] = useState<'pan' | 'draw'>('pan');
  const [drawingPoints, setDrawingPoints] = useState<Position[]>([]);
  const [selectedExclusionId, setSelectedExclusionId] = useState<string | null>(null);
  const [showHiddenRoads, setShowHiddenRoads] = useState(false);
  const [selectedHiddenRoadGroupId, setSelectedHiddenRoadGroupId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [apartmentSelection, setApartmentSelection] = useState<{
    id: string;
    source: ApartmentSelectionSource;
  } | null>(null);
  const [polygonError, setPolygonError] = useState('');
  const [radiusInput, setRadiusInput] = useState(String(initialDraft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressQuery, setAddressQuery] = useState(initialDraft.originAddress);
  const [pendingAddress, setPendingAddress] = useState<PendingAddress | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saveFailure, setSaveFailure] = useState<TerritorySaveFailure | null>(null);
  const [backgroundImportComplete, setBackgroundImportComplete] = useState(false);
  const [notice, setNotice] = useState('Saved territory loaded.');
  const addressInputRef = useRef<HTMLTextAreaElement>(null);

  const drawingPolygon = drawingPoints.length >= 3 ? closePolygon(drawingPoints) : null;
  const drawingIsValid = drawingPolygon ? polygonIsSimple(drawingPolygon) : false;
  const previewDraft = useMemo<TerritoryDraftInput>(() => {
    if (!drawingPolygon || !drawingIsValid) {
      return draft;
    }
    return {
      ...draft,
      exclusions: [
        ...draft.exclusions,
        {
          id: '__drawing-preview__',
          name: 'Drawing preview',
          enabled: true,
          geometry: drawingPolygon,
        },
      ],
    };
  }, [draft, drawingIsValid, drawingPolygon]);
  const live = useMemo(
    () => deriveTerritory(savedWorkspace.segments, previewDraft),
    [previewDraft, savedWorkspace.segments],
  );
  const liveApartments = useMemo(() => {
    const statuses = new Map(
      (previewDraft.apartmentStatuses ?? []).map(({ id, reviewStatus }) => [id, reviewStatus]),
    );
    return savedWorkspace.apartmentComplexes.map((apartment) => ({
      ...apartment,
      reviewStatus: statuses.get(apartment.id) ?? apartment.reviewStatus,
      withinBoundary: pointInsideTerritoryBoundary(
        apartment.position,
        previewDraft.center,
        previewDraft.radiusMiles,
        previewDraft.boundaryShape,
      ),
    }));
  }, [previewDraft, savedWorkspace.apartmentComplexes]);
  const isDirty = hasUnsavedTerritoryChanges(savedDraft, draft, []);
  const hasUnsavedChanges = hasUnsavedTerritoryChanges(savedDraft, draft, drawingPoints);
  const importRequired = needsTerritoryImport(savedWorkspace.import, draft);
  const canSave = isDirty || importRequired;
  const verificationRequired = saveFailure?.recovery === 'reload';
  const leaveControlsDisabled = territoryLeaveControlsDisabled({
    saving,
    verificationRequired,
  });
  const radiusError =
    !Number.isFinite(Number(radiusInput)) || Number(radiusInput) < 1 || Number(radiusInput) > 20
      ? 'Enter a boundary distance from 1 to 20 miles.'
      : '';
  const selectedExclusion =
    draft.exclusions.find((area) => area.id === selectedExclusionId) ?? null;
  const selectedHiddenRoadSegments = selectedHiddenRoadGroupId
    ? live.segments.filter(
        (segment) =>
          segment.withinBoundary &&
          !segment.active &&
          segment.roadGroupId === selectedHiddenRoadGroupId,
      )
    : [];
  const selectedHiddenRoadTracts = selectedHiddenRoadSegments.reduce(
    (total, segment) => total + segment.estimatedHomes,
    0,
  );
  const selectedSegment =
    live.segments.find(
      (segment) =>
        segment.withinBoundary &&
        segment.id === selectedSegmentId &&
        (segment.eligible || segment.manuallyExcluded),
    ) ?? null;
  const selectedApartment =
    liveApartments.find(
      (apartment) => apartment.withinBoundary && apartment.id === apartmentSelection?.id,
    ) ?? null;

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

  const addDrawingPoint = useCallback((point: Position) => {
    setDrawingPoints((current) => [...current, point]);
    setPolygonError('');
  }, []);

  const changeDrawingPoints = useCallback((points: Position[]) => {
    setDrawingPoints(points);
    setPolygonError(
      points.length >= 3 && !polygonIsSimple(closePolygon(points))
        ? 'The polygon crosses itself. Move a corner before finishing.'
        : '',
    );
  }, []);

  const changeExclusion = useCallback((id: string, points: Position[]) => {
    const geometry = closePolygon(points);
    setDraft((current) => ({
      ...current,
      exclusions: current.exclusions.map((area) => (area.id === id ? { ...area, geometry } : area)),
    }));
    setPolygonError(
      polygonIsSimple(geometry) ? '' : 'The polygon crosses itself. Move a corner before saving.',
    );
  }, []);

  const selectHiddenRoadGroup = useCallback((roadGroupId: string) => {
    setSelectedHiddenRoadGroupId(roadGroupId);
    setSelectedSegmentId(null);
    setSelectedExclusionId(null);
    setApartmentSelection(null);
    setMode('pan');
  }, []);

  const selectSegment = useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
    setSelectedHiddenRoadGroupId(null);
    setSelectedExclusionId(null);
    setApartmentSelection(null);
    setMode('pan');
    setPolygonError('');
  }, []);

  const selectExclusion = useCallback((exclusionId: string) => {
    setSelectedExclusionId(exclusionId);
    setSelectedHiddenRoadGroupId(null);
    setSelectedSegmentId(null);
    setApartmentSelection(null);
    setMode('pan');
    setPolygonError('');
  }, []);

  const selectApartment = useCallback((apartmentId: string, source: ApartmentSelectionSource) => {
    setApartmentSelection(createApartmentSelection(apartmentId, source));
    setSelectedExclusionId(null);
    setSelectedHiddenRoadGroupId(null);
    setSelectedSegmentId(null);
    setMode('pan');
    setPolygonError('');
  }, []);

  function startDrawing() {
    setMode('draw');
    setDrawingPoints([]);
    setSelectedExclusionId(null);
    setSelectedHiddenRoadGroupId(null);
    setSelectedSegmentId(null);
    setApartmentSelection(null);
    setPolygonError('');
  }

  function cancelDrawing() {
    setMode('pan');
    setDrawingPoints([]);
    setPolygonError('');
  }

  function finishDrawing() {
    if (!drawingPolygon || !drawingIsValid) {
      setPolygonError('Add at least three points without crossing the polygon.');
      return;
    }
    const id = `exclude-${crypto.randomUUID()}`;
    setDraft((current) => ({
      ...current,
      exclusions: [
        ...current.exclusions,
        {
          id,
          name: nextExclusionName(current.exclusions),
          enabled: true,
          geometry: drawingPolygon,
        },
      ],
    }));
    setSelectedExclusionId(id);
    setDrawingPoints([]);
    setMode('pan');
    setPolygonError('');
  }

  function cancelChanges() {
    setDraft(structuredClone(savedDraft));
    setRadiusInput(String(savedDraft.radiusMiles));
    setMode('pan');
    setDrawingPoints([]);
    setSelectedExclusionId(null);
    setSelectedHiddenRoadGroupId(null);
    setSelectedSegmentId(null);
    setApartmentSelection(null);
    setPolygonError('');
    setAddressEditing(false);
    setPendingAddress(null);
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
    setNotice('Church location changed in this draft. Excluded areas stayed in place.');
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
    const outcome = await readMutationResult(
      () =>
        fetch('/api/territory', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }),
      isTerritoryWorkspacePayload,
    );
    if (outcome.status !== 'success') {
      const message =
        outcome.status === 'rejected'
          ? outcome.message
          : willImport
            ? 'Streetlight could not confirm whether the street import and territory save finished. Your current draft is still visible. Reload to verify before trying again.'
            : 'Streetlight could not confirm whether the territory changes were saved. Your current draft is still visible. Reload to verify before trying again.';
      setSaveFailure({ message, recovery: outcome.recovery, willImport });
      setNotice(message);
      setSaving(false);
      setImporting(false);
      return;
    }

    const result = outcome.value;
    const nextDraft = territoryDraftFromWorkspace(result);
    setSavedWorkspace(result);
    setDraft(nextDraft);
    setSavedDraft(structuredClone(nextDraft));
    setRadiusInput(String(nextDraft.radiusMiles));
    setSelectedExclusionId(null);
    setSelectedHiddenRoadGroupId(null);
    setSelectedSegmentId(null);
    setApartmentSelection(null);
    try {
      await onSaved(result);
      setNotice('Territory changes saved.');
    } catch {
      setNotice('Territory saved, but coverage could not refresh. Reload the page to retry.');
    }
    if (willImport && !setupRequired) setBackgroundImportComplete(true);
    if (leaveAfterSave && !leaveWhileImportRuns) onSaveAndLeave();
    setSaving(false);
    setImporting(false);
  }

  const operationPlacement =
    importing || saveFailure?.willImport || backgroundImportComplete
      ? setupRequired
        ? 'surface'
        : 'global'
      : 'surface';
  const saveStatus =
    saving || saveFailure || backgroundImportComplete ? (
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
                  ? 'Streetlight is preparing the first coverage map. Keep this page open.'
                  : 'The previous saved territory is still active. You can keep working.'
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
                ? 'Importing street data'
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
        boundaryShape={draft.boundaryShape}
        center={draft.center}
        drawing={mode === 'draw'}
        drawingPoints={drawingPoints}
        exclusions={draft.exclusions}
        map={map}
        mutationLocked={leaveControlsDisabled}
        onAddDrawingPoint={addDrawingPoint}
        onDrawingPointsChange={changeDrawingPoints}
        onExclusionChange={changeExclusion}
        onSelectExclusion={selectExclusion}
        onSelectHiddenRoadGroup={selectHiddenRoadGroup}
        onSelectSegment={selectSegment}
        apartmentSelectionSource={apartmentSelection?.source ?? null}
        onSelectApartment={(id) => selectApartment(id, 'map')}
        radiusMiles={draft.radiusMiles}
        segments={live.segments}
        selectedExclusionId={selectedExclusionId}
        selectedHiddenRoadGroupId={selectedHiddenRoadGroupId}
        selectedSegmentId={selectedSegment?.id ?? null}
        selectedApartmentId={selectedApartment?.id ?? null}
        selectedApartmentPosition={selectedApartment?.position ?? null}
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
            {mode === 'draw' && (
              <div className="drawing-instructions">
                <div>
                  <strong>
                    {drawingPoints.length} {drawingPoints.length === 1 ? 'point' : 'points'} added
                  </strong>
                  <span>
                    {drawingPoints.length < 3
                      ? 'Click around the unwanted area. Press Enter to add the map center.'
                      : drawingIsValid
                        ? 'Affected streets are gray. Drag a corner or finish.'
                        : 'The polygon crosses itself.'}
                  </span>
                </div>
                <button
                  disabled={drawingPoints.length === 0}
                  onClick={() => setDrawingPoints((points) => points.slice(0, -1))}
                  type="button"
                >
                  Undo point
                </button>
                <button onClick={cancelDrawing} type="button">
                  Cancel
                </button>
                <button disabled={!drawingIsValid} onClick={finishDrawing} type="button">
                  Finish polygon
                </button>
              </div>
            )}
          </>,
          overlayRoot,
        )}

      <aside aria-busy={saving} className="territory-sidebar tool-sidebar" hidden={!active}>
        {!setupRequired && (
          <ToolViewSwitcher
            label="Setup views"
            onChange={(view) => onViewChange(view as 'territory' | 'printouts')}
            options={setupToolViews}
            value="territory"
          />
        )}
        <div className="sidebar-scroll" inert={saving || verificationRequired}>
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
          <section>
            <h2>Church location</h2>
            {!addressEditing ? (
              <div className="address-card">
                <strong>{draft.originAddress}</strong>
                <button
                  onClick={() => {
                    setAddressEditing(true);
                    setAddressQuery(draft.originAddress);
                  }}
                  type="button"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="address-editor">
                <label htmlFor="church-address">Church address</label>
                <textarea
                  id="church-address"
                  onChange={(event) => {
                    setAddressQuery(event.target.value);
                    setPendingAddress(null);
                  }}
                  rows={3}
                  ref={addressInputRef}
                  value={addressQuery}
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => {
                      setAddressEditing(false);
                      setPendingAddress(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={geocoding || addressQuery.trim().length === 0}
                    onClick={lookUpAddress}
                    type="button"
                  >
                    Look up
                  </button>
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
                    max="20"
                    min="1"
                    onChange={(event) => {
                      setRadiusInput(event.target.value);
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 1 && value <= 20) {
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
                max="20"
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
                <span>20 miles</span>
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

          <section className="apartment-section">
            <div className="section-row">
              <h2>Apartment complex</h2>
              <span>{liveApartments.filter(({ withinBoundary }) => withinBoundary).length}</span>
            </div>
            <label className="apartment-selector">
              Apartment complex
              <select
                onChange={(event) => {
                  if (event.target.value) selectApartment(event.target.value, 'selector');
                  else setApartmentSelection(null);
                }}
                value={selectedApartment?.id ?? ''}
              >
                <option value="">Choose a complex</option>
                {liveApartments
                  .filter(({ withinBoundary }) => withinBoundary)
                  .map((apartment) => (
                    <option key={apartment.id} value={apartment.id}>
                      {apartmentOptionLabel(apartment)}
                    </option>
                  ))}
              </select>
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
                            apartmentStatuses: (current.apartmentStatuses ?? []).map((apartment) =>
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

          <section className="segment-section">
            <h2>Road segment</h2>
            {selectedSegment ? (
              <div className="segment-card">
                <strong>{selectedSegment.streetName || 'Unnamed road'}</strong>
                <span>
                  {selectedSegment.estimatedHomes} estimated tract
                  {selectedSegment.estimatedHomes === 1 ? '' : 's'} ·{' '}
                  {selectedSegment.manuallyExcluded ? 'Excluded' : 'Eligible'}
                </span>
                <button
                  onClick={() => {
                    const exclude = !selectedSegment.manuallyExcluded;
                    setDraft((current) => setSegmentExcluded(current, selectedSegment.id, exclude));
                    setNotice(
                      exclude
                        ? 'Segment excluded in this draft. Save changes to keep it.'
                        : 'Segment restored in this draft. Boundary and excluded areas still apply.',
                    );
                  }}
                  type="button"
                >
                  {selectedSegment.manuallyExcluded ? 'Restore segment' : 'Exclude segment'}
                </button>
              </div>
            ) : (
              <p className="empty-state">
                Select an orange segment, or a gray segment you excluded.
              </p>
            )}
          </section>

          <section className="hidden-roads-section">
            <div className="section-row">
              <h2>Missing roads</h2>
              <label className="hidden-roads-toggle">
                <input
                  checked={showHiddenRoads}
                  onChange={(event) => {
                    setShowHiddenRoads(event.target.checked);
                    if (!event.target.checked) {
                      setSelectedHiddenRoadGroupId(null);
                    }
                  }}
                  type="checkbox"
                />
                Show hidden roads
              </label>
            </div>
            {selectedHiddenRoadSegments.length > 0 ? (
              <div className="hidden-road-card">
                <strong>{selectedHiddenRoadSegments[0].streetName}</strong>
                <span>
                  {selectedHiddenRoadSegments.length} segment
                  {selectedHiddenRoadSegments.length === 1 ? '' : 's'} · {selectedHiddenRoadTracts}{' '}
                  estimated tract
                  {selectedHiddenRoadTracts === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => {
                    if (!selectedHiddenRoadGroupId) {
                      return;
                    }
                    setDraft((current) => ({
                      ...current,
                      activatedRoadGroupIds: [
                        ...current.activatedRoadGroupIds,
                        selectedHiddenRoadGroupId,
                      ],
                    }));
                    setSelectedHiddenRoadGroupId(null);
                    setNotice('Road activated in this draft. Save changes to keep it.');
                  }}
                  type="button"
                >
                  Activate road
                </button>
              </div>
            ) : (
              <p className="empty-state">
                {showHiddenRoads
                  ? 'Select a blue-gray road on the map.'
                  : 'Reveal uncertain Overture roads when one appears to be missing.'}
              </p>
            )}
          </section>

          <section className="exclusions-section">
            <h2>Excluded areas</h2>
            <button className="draw-button" onClick={startDrawing} type="button">
              + Draw exclusion area
            </button>
            {mode === 'draw' && (
              <VertexControls points={drawingPoints} onChange={changeDrawingPoints} />
            )}
            {draft.exclusions.length === 0 ? (
              <p className="empty-state">No areas excluded yet.</p>
            ) : (
              <ul className="exclusion-list">
                {draft.exclusions.map((area) => {
                  const impact = affectedByExclusion(live.segments, area);
                  return (
                    <li className={area.enabled ? undefined : 'disabled'} key={area.id}>
                      <label className="exclusion-toggle">
                        <input
                          aria-label={`Enable ${area.name || 'unnamed excluded area'}`}
                          checked={area.enabled}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              exclusions: current.exclusions.map((candidate) =>
                                candidate.id === area.id
                                  ? { ...candidate, enabled: event.target.checked }
                                  : candidate,
                              ),
                            }))
                          }
                          type="checkbox"
                        />
                      </label>
                      <button
                        className="exclusion-select"
                        aria-pressed={area.id === selectedExclusionId}
                        onClick={() => selectExclusion(area.id)}
                        type="button"
                      >
                        <span>
                          <strong>{area.name || 'Unnamed excluded area'}</strong>
                          <small>
                            {area.enabled
                              ? `${impact.segments} segments excluded`
                              : `Off · would exclude ${impact.segments} segments`}
                          </small>
                        </span>
                      </button>
                      <button
                        aria-label={`Delete ${area.name || 'unnamed excluded area'}`}
                        className="exclusion-delete"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete ${area.name || 'this excluded area'}? Its saved shape will be lost.`,
                            )
                          ) {
                            return;
                          }
                          setDraft((current) => ({
                            ...current,
                            exclusions: current.exclusions.filter(
                              (candidate) => candidate.id !== area.id,
                            ),
                          }));
                          if (selectedExclusionId === area.id) {
                            setSelectedExclusionId(null);
                          }
                          setPolygonError('');
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedExclusion && (
              <div className="exclusion-editor">
                <label>
                  Optional name
                  <input
                    maxLength={100}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        exclusions: current.exclusions.map((area) =>
                          area.id === selectedExclusion.id
                            ? { ...area, name: event.target.value }
                            : area,
                        ),
                      }))
                    }
                    value={selectedExclusion.name}
                  />
                </label>
                <div className="impact-row">
                  <span>
                    {selectedExclusion.enabled ? 'Segments excluded' : 'Segments if enabled'}
                  </span>
                  <strong>{affectedByExclusion(live.segments, selectedExclusion).segments}</strong>
                </div>
                <div className="impact-row">
                  <span>{selectedExclusion.enabled ? 'Tracts removed' : 'Tracts if enabled'}</span>
                  <strong>{affectedByExclusion(live.segments, selectedExclusion).homes}</strong>
                </div>
                <VertexControls
                  points={selectedExclusion.geometry.coordinates[0].slice(0, -1)}
                  onChange={(points) => changeExclusion(selectedExclusion.id, points)}
                />
                <button
                  className="secondary"
                  onClick={() => setSelectedExclusionId(null)}
                  type="button"
                >
                  Done editing
                </button>
              </div>
            )}
          </section>
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
                <p aria-live="polite">{polygonError || notice}</p>
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
                  disabled={
                    !canSave ||
                    saving ||
                    verificationRequired ||
                    mode === 'draw' ||
                    Boolean(radiusError || polygonError)
                  }
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
