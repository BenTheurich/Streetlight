'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerritoryWorkspace } from '@/lib/database';
import {
  affectedByExclusion,
  deriveTerritory,
  nextExclusionName,
  territoryDraftFromWorkspace,
} from '@/lib/territory-client';
import type { TerritoryDraftInput } from '@/lib/territory-draft';
import { closePolygon, type Position, polygonIsSimple } from '@/lib/territory-geometry';
import { TerritoryMap } from './TerritoryMap';

type PendingAddress = {
  formattedAddress: string;
  center: Position;
};

function draftKey(draft: TerritoryDraftInput): string {
  return JSON.stringify(draft);
}

export function TerritoryEditor({
  initialData,
  mapsApiKey,
}: {
  initialData: TerritoryWorkspace;
  mapsApiKey: string;
}) {
  const initialDraft = territoryDraftFromWorkspace(initialData);
  const [workspace, setWorkspace] = useState(initialData);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [mode, setMode] = useState<'pan' | 'draw'>('pan');
  const [drawingPoints, setDrawingPoints] = useState<Position[]>([]);
  const [selectedExclusionId, setSelectedExclusionId] = useState<string | null>(null);
  const [polygonError, setPolygonError] = useState('');
  const [radiusInput, setRadiusInput] = useState(String(initialDraft.radiusMiles));
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressQuery, setAddressQuery] = useState(initialDraft.originAddress);
  const [pendingAddress, setPendingAddress] = useState<PendingAddress | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
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
    () => deriveTerritory(workspace.segments, previewDraft),
    [previewDraft, workspace.segments],
  );
  const isDirty = draftKey(draft) !== draftKey(savedDraft);
  const radiusError =
    !Number.isFinite(Number(radiusInput)) || Number(radiusInput) < 1 || Number(radiusInput) > 20
      ? 'Enter a radius from 1 to 20 miles.'
      : '';
  const selectedExclusion =
    draft.exclusions.find((area) => area.id === selectedExclusionId) ?? null;

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

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

  function startDrawing() {
    setMode('draw');
    setDrawingPoints([]);
    setSelectedExclusionId(null);
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
    setSaving(true);
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
      setWorkspace(result);
      setDraft(nextDraft);
      setSavedDraft(structuredClone(nextDraft));
      setRadiusInput(String(nextDraft.radiusMiles));
      setSelectedExclusionId(null);
      setNotice('Territory changes saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save territory');
    } finally {
      setSaving(false);
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
        <section className="map-panel" aria-label="Territory eligibility preview">
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
            radiusMiles={draft.radiusMiles}
            segments={live.segments}
            selectedExclusionId={selectedExclusionId}
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

        <aside className="territory-sidebar">
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
            </section>

            <section className="exclusions-section">
              <h2>Excluded areas</h2>
              <button className="draw-button" onClick={startDrawing} type="button">
                + Draw exclusion area
              </button>
              {draft.exclusions.length === 0 ? (
                <p className="empty-state">No areas excluded yet.</p>
              ) : (
                <ul className="exclusion-list">
                  {draft.exclusions.map((area) => {
                    const impact = affectedByExclusion(workspace.segments, area);
                    return (
                      <li key={area.id}>
                        <button
                          aria-pressed={area.id === selectedExclusionId}
                          onClick={() => {
                            setSelectedExclusionId(area.id);
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
                      {affectedByExclusion(workspace.segments, selectedExclusion).segments}
                    </strong>
                  </div>
                  <div className="impact-row">
                    <span>Tracts removed</span>
                    <strong>
                      {affectedByExclusion(workspace.segments, selectedExclusion).homes}
                    </strong>
                  </div>
                  <p>Drag any corner on the map to reshape this area.</p>
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
            <div>
              <button
                className="secondary"
                disabled={!isDirty || saving}
                onClick={cancelChanges}
                type="button"
              >
                Cancel
              </button>
              <button
                disabled={
                  !isDirty || saving || mode === 'draw' || Boolean(radiusError || polygonError)
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
    </div>
  );
}
