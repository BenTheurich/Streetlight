'use client';

import { type CSSProperties, useState } from 'react';
import { countEligibleHomesByCoverageClass, stackCoverageLabelRows } from '@/lib/coverage';
import type { CoverageWorkspace, CoverageWorkspaceSegment } from '@/lib/database';

type CoverageDashboardProps = {
  active: boolean;
  workspace: CoverageWorkspace;
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onWorkspaceChange: (workspace: CoverageWorkspace) => void;
  onOpenPackets: () => void;
  onOpenReconciliation: () => void;
};

const coverageClasses = ['green', 'yellow', 'orange', 'red'] as const;
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function CoverageDashboard({
  active,
  workspace,
  selectedSegmentId,
  onSelectSegment,
  onWorkspaceChange,
  onOpenPackets,
  onOpenReconciliation,
}: CoverageDashboardProps) {
  const [dates, setDates] = useState<Record<string, string>>({});
  const [activeMutation, setActiveMutation] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const selected = workspace.segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const distribution = countEligibleHomesByCoverageClass(workspace.segments);
  const distributionItems = coverageClasses.map((coverageClass) => ({
    coverageClass,
    homes: distribution[coverageClass],
  }));
  const totalHomes = distributionItems.reduce((total, item) => total + item.homes, 0);
  const visibleDistributionItems = distributionItems.filter((item) => item.homes > 0);
  let precedingHomes = 0;
  const positionedDistributionItems = visibleDistributionItems.map((item) => {
    const positionPercent = ((precedingHomes + item.homes / 2) / totalHomes) * 100;
    precedingHomes += item.homes;
    return { ...item, positionPercent };
  });
  const labelRows = stackCoverageLabelRows([
    ...positionedDistributionItems.map(({ positionPercent }) => ({
      positionPercent,
      gapPercent: 12,
    })),
    { positionPercent: 100, gapPercent: 25 },
  ]);
  const distributionMarkers = positionedDistributionItems.map((item, index) => ({
    ...item,
    labelRow: labelRows[index],
  }));
  const totalLabelRow = labelRows.at(-1) ?? 0;
  const maxLabelRow = Math.max(...labelRows, 0);

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
      onWorkspaceChange(result);
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
    <aside className="territory-sidebar coverage-sidebar" hidden={!active}>
      <div className="sidebar-scroll">
        <section aria-labelledby="coverage-distribution-heading" className="coverage-distribution">
          <h2 id="coverage-distribution-heading">Current estimated progress</h2>
          <div
            className="coverage-distribution-chart"
            style={{ '--coverage-max-label-row': maxLabelRow } as CSSProperties}
          >
            <div
              aria-label={visibleDistributionItems
                .map(
                  (item) => `${item.coverageClass}: ${item.homes.toLocaleString()} estimated homes`,
                )
                .join('; ')}
              className="coverage-distribution-bar"
              role="img"
            >
              {distributionMarkers.map((item) => (
                <span
                  className={`coverage-distribution-segment ${item.coverageClass}`}
                  key={item.coverageClass}
                  style={{ flexGrow: item.homes }}
                >
                  <span
                    className={
                      item.homes / totalHomes < 0.08
                        ? 'coverage-distribution-marker edge'
                        : 'coverage-distribution-marker'
                    }
                    style={{ '--coverage-label-row': item.labelRow } as CSSProperties}
                  >
                    <strong>{item.homes.toLocaleString()}</strong>
                  </span>
                </span>
              ))}
            </div>
            <p
              className="coverage-distribution-total"
              style={{ '--coverage-label-row': totalLabelRow } as CSSProperties}
            >
              <strong>{totalHomes.toLocaleString()}</strong> total
            </p>
          </div>
        </section>
        <section className="coverage-segment-picker">
          <label className="coverage-field">
            Street segment
            <select
              onChange={(event) => onSelectSegment(event.target.value || null)}
              value={selectedSegmentId ?? ''}
            >
              <option value="">Select a street segment</option>
              {workspace.segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.streetName} — {segment.estimatedHomes} tracts · {segment.id.slice(-6)}
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
                    {root.packetId ? (
                      <div className="packet-managed-coverage">
                        <p>This completion belongs to a whole packet.</p>
                        <button className="secondary" onClick={onOpenReconciliation} type="button">
                          Open Reconcile packets
                        </button>
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                );
              })
            )}
          </section>
        )}
        <section className="current-work">
          <h2>Current work</h2>
          {workspace.activePackets > 0 ? (
            <div className="current-work-layout">
              <span aria-hidden="true" className="current-work-count">
                {workspace.activePackets}
              </span>
              <div className="current-work-copy">
                <strong>
                  <span className="sr-only">{workspace.activePackets} </span>
                  active packet
                  {workspace.activePackets === 1 ? '' : 's'} awaiting reconciliation
                </strong>
                <p>
                  {workspace.latestBatch
                    ? `${workspace.latestBatch.name} is the newest finalized batch.`
                    : 'Check which printed sheets are still on the table.'}
                </p>
                <button onClick={onOpenReconciliation} type="button">
                  Reconcile packets
                </button>
              </div>
            </div>
          ) : (
            <div className="current-work-layout current-work-layout-ready">
              <div className="current-work-copy">
                <strong>Coverage is ready for another batch.</strong>
                <p>Generate connected packets from the streets that have waited longest.</p>
                <button onClick={onOpenPackets} type="button">
                  Generate packets
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="sidebar-actions">
        <p aria-live="polite">{notice}</p>
      </div>
    </aside>
  );
}
