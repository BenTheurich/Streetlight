'use client';

import { useState } from 'react';
import { countEligibleHomesCovered } from '@/lib/coverage';
import type { CoverageWorkspace, CoverageWorkspaceSegment } from '@/lib/database';
import { CoverageMap } from './CoverageMap';

type CoverageDashboardProps = {
  initialData: CoverageWorkspace;
  mapsApiKey: string;
};

const periods = [30, 90, 180, 365];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function CoverageDashboard({ initialData, mapsApiKey }: CoverageDashboardProps) {
  const [workspace, setWorkspace] = useState(initialData);
  const [period, setPeriod] = useState(90);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialData.segments.find((segment) => segment.eligible)?.id ?? null,
  );
  const [dates, setDates] = useState<Record<string, string>>({});
  const [activeMutation, setActiveMutation] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const eligibleSegments = workspace.segments.filter((segment) => segment.eligible);
  const selected = eligibleSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
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
        </div>
        <a href="/territory">Territory setup</a>
      </header>
      <main className="territory-workspace coverage-workspace">
        <section className="map-panel">
          <CoverageMap
            apiKey={mapsApiKey}
            center={workspace.center}
            onSelectSegment={setSelectedSegmentId}
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
                <span>Total eligible tracts</span>
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
              <label className="coverage-field">
                Street segment
                <select
                  onChange={(event) => setSelectedSegmentId(event.target.value || null)}
                  value={selectedSegmentId ?? ''}
                >
                  <option value="">Select a street segment</option>
                  {eligibleSegments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.streetName}
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
