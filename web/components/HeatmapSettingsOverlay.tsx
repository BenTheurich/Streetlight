'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { CoverageThresholds } from '@/lib/coverage';
import type { CoverageWorkspace } from '@/lib/database';

type HeatmapSettingsOverlayProps = {
  open: boolean;
  showApartmentMarkers: boolean;
  thresholds: CoverageThresholds;
  onClose: () => void;
  onSaved: (workspace: CoverageWorkspace) => void;
  onShowApartmentMarkersChange: (show: boolean) => void;
};

const fields: Array<{ key: keyof CoverageThresholds; label: string }> = [
  { key: 'yellowAfterDays', label: 'Yellow starts at' },
  { key: 'orangeAfterDays', label: 'Orange starts at' },
  { key: 'redAfterDays', label: 'Red starts at' },
];

export function HeatmapSettingsOverlay({
  open,
  showApartmentMarkers,
  thresholds,
  onClose,
  onSaved,
  onShowApartmentMarkersChange,
}: HeatmapSettingsOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({
    yellowAfterDays: String(thresholds.yellowAfterDays),
    orangeAfterDays: String(thresholds.orangeAfterDays),
    redAfterDays: String(thresholds.redAfterDays),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    setDraft({
      yellowAfterDays: String(thresholds.yellowAfterDays),
      orangeAfterDays: String(thresholds.orangeAfterDays),
      redAfterDays: String(thresholds.redAfterDays),
    });
    setError('');
    const frame = requestAnimationFrame(() => firstInputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)',
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [
    onClose,
    open,
    thresholds.orangeAfterDays,
    thresholds.redAfterDays,
    thresholds.yellowAfterDays,
  ]);

  async function saveRanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/coverage', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          yellowAfterDays: Number(draft.yellowAfterDays),
          orangeAfterDays: Number(draft.orangeAfterDays),
          redAfterDays: Number(draft.redAfterDays),
        }),
      });
      const result = (await response.json()) as CoverageWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not save heatmap ranges');
      }
      onSaved(result);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save heatmap ranges');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="heatmap-settings-overlay">
      <button
        aria-label="Dismiss map settings"
        className="heatmap-settings-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby="heatmap-settings-title"
        aria-modal="true"
        className="heatmap-settings-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id="heatmap-settings-title">Map settings</h2>
          <button
            aria-label="Close map settings"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <form className="heatmap-settings-form" onSubmit={(event) => void saveRanges(event)}>
          <h3>Heatmap ranges</h3>
          {fields.map(({ key, label }, index) => (
            <label key={key}>
              {label}
              <span>
                <input
                  aria-describedby={error ? 'heatmap-settings-error' : undefined}
                  aria-invalid={error ? true : undefined}
                  inputMode="numeric"
                  max="3650"
                  min="1"
                  onChange={(event) => {
                    setError('');
                    setDraft((current) => ({ ...current, [key]: event.target.value }));
                  }}
                  ref={index === 0 ? firstInputRef : undefined}
                  required
                  step="1"
                  type="number"
                  value={draft[key]}
                />
                days since last outreach
              </span>
            </label>
          ))}
          {error && (
            <p className="coverage-range-error" id="heatmap-settings-error" role="alert">
              {error}
            </p>
          )}
          <section aria-labelledby="map-display-settings-title" className="map-display-settings">
            <h3 id="map-display-settings-title">Map display</h3>
            <label className="map-display-toggle">
              <span>Show apartment markers</span>
              <input
                aria-checked={showApartmentMarkers}
                checked={showApartmentMarkers}
                onChange={(event) => onShowApartmentMarkersChange(event.target.checked)}
                role="switch"
                type="checkbox"
              />
            </label>
          </section>
          <div className="heatmap-settings-actions">
            <button className="secondary" disabled={saving} onClick={onClose} type="button">
              Close
            </button>
            <button disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save ranges'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
