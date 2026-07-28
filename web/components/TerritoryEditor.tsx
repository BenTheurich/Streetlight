'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerritoryWorkspace } from '@/lib/database';
import {
  affectedByExclusion,
  deriveTerritory,
  hasUnsavedTerritoryChanges,
  moveVertexWithArrowKey,
  nextExclusionName,
  territoryDraftFromWorkspace,
} from '@/lib/territory-client';
import type { TerritoryDraftInput } from '@/lib/territory-draft';
import { closePolygon, type Position, polygonIsSimple } from '@/lib/territory-geometry';
import { needsTerritoryImport } from '@/lib/territory-import';
import { TerritoryMap } from './TerritoryMap';

type PendingAddress = {
  formattedAddress: string;
  center: Position;
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
  initialData,
  mapsApiKey,
}: {
  initialData: TerritoryWorkspace;
  mapsApiKey: string;
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
  const [polygonError, setPolygonError] = useState('');
  const [radiusInput, setRadiusInput] = useState(String(initialDraft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressQuery, setAddressQuery] = useState(initialDraft.originAddress);
  const [pendingAddress, setPendingAddress] = useState<PendingAddress | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
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
          geometry: drawingPolygon,
        },
      ],
    };
  }, [draft, drawingIsValid, drawingPolygon]);
  const live = useMemo(
    () => deriveTerritory(savedWorkspace.segments, previewDraft),
    [previewDraft, savedWorkspace.segments],
  );
  const isDirty = hasUnsavedTerritoryChanges(savedDraft, draft, []);
  const hasUnsavedChanges = hasUnsavedTerritoryChanges(savedDraft, draft, drawingPoints);
  const importRequired = needsTerritoryImport(savedWorkspace.import, draft);
  const canSave = isDirty || importRequired;
  const radiusError =
    !Number.isFinite(Number(radiusInput)) || Number(radiusInput) < 1 || Number(radiusInput) > 20
      ? 'Enter a radius from 1 to 20 miles.'
      : '';
  const selectedExclusion =
    draft.exclusions.find((area) => area.id === selectedExclusionId) ?? null;
  const selectedHiddenRoadSegments = selectedHiddenRoadGroupId
    ? live.segments.filter(
        (segment) => !segment.active && segment.roadGroupId === selectedHiddenRoadGroupId,
      )
    : [];

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
    setSelectedExclusionId(null);
    setMode('pan');
  }, []);

  function startDrawing() {
    setMode('draw');
    setDrawingPoints([]);
    setSelectedExclusionId(null);
    setSelectedHiddenRoadGroupId(null);
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

  async function saveChanges() {
    const willImport = needsTerritoryImport(savedWorkspace.import, draft);
    setSaving(true);
    setImporting(willImport);
    setNotice('Saving changes…');
    try {
      const response = await fetch('/api/territory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const result = (await response.json()) as TerritoryWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not save territory');
      }
      const nextDraft = territoryDraftFromWorkspace(result);
      setSavedWorkspace(result);
      setDraft(nextDraft);
      setSavedDraft(structuredClone(nextDraft));
      setRadiusInput(String(nextDraft.radiusMiles));
      setSelectedExclusionId(null);
      setSelectedHiddenRoadGroupId(null);
      setNotice('Territory changes saved.');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not save territory changes. Your draft is still here.',
      );
    } finally {
      setSaving(false);
      setImporting(false);
    }
  }

  return (
    <div className="territory-page">
      <header className="territory-header">
        <div>
          <span className="wordmark">Streetlight</span>
          <span className="phase-label">Territory Setup</span>
        </div>
        <a href="/">← Back to coverage map</a>
      </header>

      <main className="territory-workspace">
        <section
          aria-busy={saving}
          aria-label="Territory eligibility preview"
          className="map-panel"
          inert={saving}
        >
          <TerritoryMap
            apiKey={mapsApiKey}
            center={draft.center}
            drawing={mode === 'draw'}
            drawingPoints={drawingPoints}
            exclusions={draft.exclusions}
            onAddDrawingPoint={addDrawingPoint}
            onDrawingPointsChange={changeDrawingPoints}
            onExclusionChange={changeExclusion}
            onSelectExclusion={setSelectedExclusionId}
            onSelectHiddenRoadGroup={selectHiddenRoadGroup}
            radiusMiles={draft.radiusMiles}
            segments={live.segments}
            selectedExclusionId={selectedExclusionId}
            selectedHiddenRoadGroupId={selectedHiddenRoadGroupId}
            showHiddenRoads={showHiddenRoads}
          />
          <fieldset className="map-modes">
            <legend className="sr-only">Map mode</legend>
            <button
              aria-pressed={mode === 'pan'}
              className={mode === 'pan' ? 'active' : ''}
              onClick={() => (mode === 'draw' ? cancelDrawing() : setMode('pan'))}
              type="button"
            >
              Pan
            </button>
            <button
              aria-pressed={mode === 'draw'}
              className={mode === 'draw' ? 'active' : ''}
              onClick={startDrawing}
              type="button"
            >
              Draw exclusion
            </button>
          </fieldset>
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
        </section>

        <aside aria-busy={saving} className="territory-sidebar" inert={saving}>
          <div className="sidebar-title">
            <h1>Territory Setup</h1>
            <p>Start with a radius around the church, then remove unsuitable areas.</p>
          </div>

          <div className="sidebar-scroll">
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
                      <p>Using this location recenters the radius. Excluded areas stay put.</p>
                      <button onClick={confirmAddress} type="button">
                        Use this address
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="radius-control">
                <div className="section-row">
                  <h2>Radius</h2>
                  <label>
                    <span className="sr-only">Radius in miles</span>
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
                  aria-label="Territory radius"
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
                    {selectedHiddenRoadSegments.length === 1 ? '' : 's'} ·{' '}
                    {selectedHiddenRoadSegments.reduce(
                      (total, segment) => total + segment.estimatedHomes,
                      0,
                    )}{' '}
                    estimated tracts
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
                    const impact = affectedByExclusion(savedWorkspace.segments, area);
                    return (
                      <li key={area.id}>
                        <button
                          aria-pressed={area.id === selectedExclusionId}
                          onClick={() => {
                            setSelectedExclusionId(area.id);
                            setSelectedHiddenRoadGroupId(null);
                            setMode('pan');
                            setPolygonError('');
                          }}
                          type="button"
                        >
                          <i />
                          <span>
                            <strong>{area.name || 'Unnamed excluded area'}</strong>
                            <small>{impact.segments} segments excluded</small>
                          </span>
                          <b aria-hidden="true">•••</b>
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
                    <span>Segments excluded</span>
                    <strong>
                      {affectedByExclusion(savedWorkspace.segments, selectedExclusion).segments}
                    </strong>
                  </div>
                  <div className="impact-row">
                    <span>Tracts removed</span>
                    <strong>
                      {affectedByExclusion(savedWorkspace.segments, selectedExclusion).homes}
                    </strong>
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
                  <button
                    className="danger"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        exclusions: current.exclusions.filter(
                          (area) => area.id !== selectedExclusion.id,
                        ),
                      }));
                      setSelectedExclusionId(null);
                      setPolygonError('');
                    }}
                    type="button"
                  >
                    Delete exclusion
                  </button>
                </div>
              )}
            </section>
          </div>

          <div className="sidebar-actions">
            <p aria-live="polite">{polygonError || notice}</p>
            {importRequired && !importing && (
              <p className="import-notice">Street data will refresh when saved.</p>
            )}
            <div>
              <button
                className="secondary"
                disabled={!hasUnsavedChanges || saving}
                onClick={cancelChanges}
                type="button"
              >
                Cancel
              </button>
              <button
                disabled={
                  !canSave || saving || mode === 'draw' || Boolean(radiusError || polygonError)
                }
                onClick={saveChanges}
                type="button"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </aside>
      </main>
      {importing && (
        <div className="import-status" role="status" aria-live="polite">
          Importing streets and addresses…
        </div>
      )}
    </div>
  );
}
