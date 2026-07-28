'use client';

import { type FormEvent, useState } from 'react';
import { type CoverageThresholds, countEligibleHomesCovered } from '@/lib/coverage';
import type { CoverageWorkspace, CoverageWorkspaceSegment } from '@/lib/database';
import { CoverageMap } from './CoverageMap';

type CoverageDashboardProps = {
  initialData: CoverageWorkspace;
  mapsApiKey: string;
};

const periods = [30, 90, 180, 365];
const rangeFields: Array<{ key: keyof CoverageThresholds; label: string }> = [
  { key: 'yellowAfterDays', label: 'Yellow starts at' },
  { key: 'orangeAfterDays', label: 'Orange starts at' },
  { key: 'redAfterDays', label: 'Red starts at' },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function CoverageDashboard({ initialData, mapsApiKey }: CoverageDashboardProps) {
  const [workspace, setWorkspace] = useState(initialData);
  const [period, setPeriod] = useState(90);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialData.segments.find((segment) => segment.eligible)?.id ??
      initialData.segments[0]?.id ??
      null,
  );
  const [dates, setDates] = useState<Record<string, string>>({});
  const [rangeDraft, setRangeDraft] = useState({
    yellowAfterDays: String(initialData.thresholds.yellowAfterDays),
    orangeAfterDays: String(initialData.thresholds.orangeAfterDays),
    redAfterDays: String(initialData.thresholds.redAfterDays),
  });
  const [activeMutation, setActiveMutation] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = workspace.segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const coveredHomes = countEligibleHomesCovered(workspace.segments, workspace.asOf, period);

  async function mutate(eventId: string, coveredOn: string | null) {
    setActiveMutation(eventId);
    setNotice('');
    try {
      const response = await fetch('/api/coverage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, coveredOn }),
      });
      const result = (await response.json()) as CoverageWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not change outreach');
      }
      setWorkspace(result);
      setNotice(coveredOn === null ? 'Outreach completion undone.' : 'Outreach date saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change outreach');
    } finally {
      setActiveMutation(null);
    }
  }

  async function saveRanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveMutation('heatmap-ranges');
    setRangeError('');
    setNotice('');
    try {
      const response = await fetch('/api/coverage', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          yellowAfterDays: Number(rangeDraft.yellowAfterDays),
          orangeAfterDays: Number(rangeDraft.orangeAfterDays),
          redAfterDays: Number(rangeDraft.redAfterDays),
        }),
      });
      const result = (await response.json()) as CoverageWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not save heatmap ranges');
      }
      setWorkspace(result);
      setRangeDraft({
        yellowAfterDays: String(result.thresholds.yellowAfterDays),
        orangeAfterDays: String(result.thresholds.orangeAfterDays),
        redAfterDays: String(result.thresholds.redAfterDays),
      });
      setNotice('Heatmap ranges saved.');
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : 'Could not save heatmap ranges');
    } finally {
      setActiveMutation(null);
    }
  }

  function rootDate(root: CoverageWorkspaceSegment['roots'][number]): string {
    return (
      dates[root.eventId] ??
      root.effectiveCoveredOn ??
      root.corrections.at(-1)?.coveredOn ??
      root.originalCoveredOn
    );
  }

  return (
    <div className="coverage-page">
      <header className="territory-header coverage-header">
        <div>
          <span className="wordmark">Streetlight</span>
          <span className="phase-label">Coverage</span>
          {workspace.dataMode === 'demo' && <span className="demo-data-label">Demo data</span>}
        </div>
        <a href="/territory">Territory setup</a>
      </header>
      <main className="territory-workspace coverage-workspace">
        <section className="map-panel">
          <CoverageMap
            apiKey={mapsApiKey}
            center={workspace.center}
            onSelectSegment={setSelectedSegmentId}
            legend={workspace.legend}
            segments={workspace.segments}
            selectedSegmentId={selectedSegmentId}
          />
        </section>
        <aside className="territory-sidebar coverage-sidebar">
          <div className="sidebar-title">
            <h1>{workspace.name}</h1>
            <p>Coverage</p>
          </div>
          <div className="sidebar-scroll">
            <section className="coverage-summary">
              <div>
                <strong>{workspace.totals.eligibleHomes}</strong>
                <span>Total estimated homes</span>
              </div>
              <div>
                <strong>{coveredHomes}</strong>
                <span>Estimated homes covered</span>
              </div>
              <div>
                <strong>{workspace.activePackets}</strong>
                <span>Active packets</span>
              </div>
            </section>
            <section>
              <label className="coverage-field">
                Coverage period
                <select onChange={(event) => setPeriod(Number(event.target.value))} value={period}>
                  {periods.map((days) => (
                    <option key={days} value={days}>
                      Last {days} days
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section>
              <h2>Heatmap ranges</h2>
              <form className="coverage-ranges" onSubmit={(event) => void saveRanges(event)}>
                {rangeFields.map(({ key, label }) => (
                  <label key={key}>
                    {label}
                    <span>
                      <input
                        aria-describedby="heatmap-ranges-error"
                        aria-invalid={rangeError ? true : undefined}
                        max="3650"
                        min="1"
                        onChange={(event) => {
                          setRangeError('');
                          setRangeDraft((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }));
                        }}
                        required
                        step="1"
                        type="number"
                        value={rangeDraft[key]}
                      />
                      days
                    </span>
                  </label>
                ))}
                <button disabled={activeMutation === 'heatmap-ranges'} type="submit">
                  Save ranges
                </button>
                <p
                  className="coverage-range-error"
                  id="heatmap-ranges-error"
                  role={rangeError ? 'alert' : undefined}
                >
                  {rangeError}
                </p>
              </form>
            </section>
            <section>
              <label className="coverage-field">
                Street segment
                <select
                  onChange={(event) => setSelectedSegmentId(event.target.value || null)}
                  value={selectedSegmentId ?? ''}
                >
                  <option value="">Select a street segment</option>
                  {workspace.segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.streetName} — {segment.estimatedHomes} tracts ·{' '}
                      {segment.id.slice(-6)}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            {selected && (
              <section className="coverage-detail">
                <h2>{selected.streetName}</h2>
                <p>
                  {selected.estimatedHomes} estimated tracts · Last outreach:{' '}
                  {selected.lastCoveredOn ? formatDate(selected.lastCoveredOn) : 'Never'}
                </p>
                {selected.roots.length === 0 ? (
                  <p className="empty-state">No completed outreach recorded.</p>
                ) : (
                  selected.roots.map((root) => {
                    const currentDate = rootDate(root);
                    const busy = activeMutation === root.eventId;
                    return (
                      <div className="coverage-root" key={root.eventId}>
                        <strong>Completed {formatDate(root.originalCoveredOn)}</strong>
                        <code className="coverage-event-id">Event ID: {root.eventId}</code>
                        <span>
                          {root.effectiveCoveredOn
                            ? `Effective ${formatDate(root.effectiveCoveredOn)}`
                            : 'Undone'}
                        </span>
                        {root.corrections.map((correction) => (
                          <small key={correction.id}>
                            {correction.isVoid
                              ? `Undone ${formatDate(correction.coveredOn)}`
                              : `Changed to ${formatDate(correction.coveredOn)}`}
                          </small>
                        ))}
                        <label>
                          Outreach date
                          <input
                            disabled={busy}
                            max={workspace.asOf}
                            onChange={(event) =>
                              setDates((current) => ({
                                ...current,
                                [root.eventId]: event.target.value,
                              }))
                            }
                            type="date"
                            value={currentDate}
                          />
                        </label>
                        <div className="coverage-actions">
                          <button
                            disabled={busy || !currentDate}
                            onClick={() => void mutate(root.eventId, currentDate)}
                            type="button"
                          >
                            {root.effectiveCoveredOn ? 'Change outreach date' : 'Restore outreach'}
                          </button>
                          <button
                            className="danger"
                            disabled={busy || !root.effectiveCoveredOn}
                            onClick={() => {
                              if (window.confirm('Undo this outreach completion?')) {
                                void mutate(root.eventId, null);
                              }
                            }}
                            type="button"
                          >
                            Undo completion
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            )}
          </div>
          <div className="sidebar-actions">
            <p aria-live="polite">{notice}</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
