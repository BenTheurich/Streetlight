'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import {
  countEligibleHomesByCoverageClass,
  coverageRoadForSegment,
  coverageRoadResultContent,
  currentWorkState,
  searchCoverageRoads,
  stackCoverageLabelRows,
} from '@/lib/coverage';
import type { CoverageWorkspace, CoverageWorkspaceSegment } from '@/lib/database';

type CoverageDashboardProps = {
  active: boolean;
  workspace: CoverageWorkspace;
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onOpenPackets: () => void;
  onOpenReconciliation: () => void;
};

const coverageClasses = ['green', 'yellow', 'orange', 'red'] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function outreachDateSummary(values: Array<string | null>): string {
  const dates = new Set(values);
  if (dates.size > 1) return 'Mixed dates';
  const [date] = dates;
  return date ? formatDate(date) : 'Never';
}

function roadDateGroups(segments: CoverageWorkspaceSegment[]) {
  const groups = new Map<
    string,
    {
      lastCoveredOn: string | null;
      coverageClass: CoverageWorkspaceSegment['coverageClass'];
      sections: number;
      estimatedTracts: number;
    }
  >();
  for (const segment of segments) {
    const key = segment.lastCoveredOn ?? 'never';
    const group = groups.get(key);
    if (group) {
      group.sections += 1;
      group.estimatedTracts += segment.estimatedHomes;
    } else {
      groups.set(key, {
        lastCoveredOn: segment.lastCoveredOn,
        coverageClass: segment.coverageClass,
        sections: 1,
        estimatedTracts: segment.estimatedHomes,
      });
    }
  }
  return [...groups.values()].sort((first, second) => {
    if (first.lastCoveredOn === null) return -1;
    if (second.lastCoveredOn === null) return 1;
    return first.lastCoveredOn.localeCompare(second.lastCoveredOn);
  });
}

export function CoverageDashboard({
  active,
  workspace,
  selectedSegmentId,
  onSelectSegment,
  onOpenPackets,
  onOpenReconciliation,
}: CoverageDashboardProps) {
  const [query, setQuery] = useState('');
  const selected = coverageRoadForSegment(workspace.segments, selectedSegmentId);
  const search = searchCoverageRoads(workspace.segments, query);
  const selectedContent = selected ? coverageRoadResultContent(selected) : null;
  const selectedDates = selected ? roadDateGroups(selected.segments) : [];
  const workState = currentWorkState(workspace.activePackets);
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

  useEffect(() => {
    if (selected) setQuery(selected.streetName);
  }, [selected]);

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
          <label className="coverage-field" htmlFor="coverage-street-search">
            Find a street
          </label>
          <input
            autoComplete="off"
            id="coverage-street-search"
            onChange={(event) => {
              setQuery(event.target.value);
              if (selectedSegmentId) onSelectSegment(null);
            }}
            placeholder="Search street names"
            type="search"
            value={query}
          />
          {!selected && !query.trim() && (
            <p className="coverage-search-status">
              Search by street name, or select a street directly on the map.
            </p>
          )}
          {!selected && query.trim() && search.total === 0 && (
            <p className="coverage-search-status" role="status">
              No streets match “{query.trim()}”.
            </p>
          )}
          {!selected && search.total > 0 && (
            <>
              <p className="coverage-search-status" role="status">
                {search.hasMore
                  ? `Showing 20 of ${search.total} roads. Refine your search to narrow the list.`
                  : `${search.total} matching ${search.total === 1 ? 'road' : 'roads'}.`}
              </p>
              <ul className="coverage-search-results">
                {search.matches.map((road) => {
                  const content = coverageRoadResultContent(road);
                  const anchor = road.segments[0];
                  return (
                    <li key={road.roadGroupId}>
                      <button
                        onClick={() => {
                          setQuery(content.streetName);
                          onSelectSegment(anchor.id);
                        }}
                        type="button"
                      >
                        <strong>{content.streetName}</strong>
                        <span>
                          {content.sections} {content.sections === 1 ? 'section' : 'sections'} ·{' '}
                          {content.estimatedTracts} estimated tract
                          {content.estimatedTracts === 1 ? '' : 's'} · Last outreach:{' '}
                          {content.lastOutreach === 'mixed'
                            ? 'Mixed dates'
                            : content.lastOutreach
                              ? formatDate(content.lastOutreach)
                              : 'Never'}
                        </span>
                        <small>{content.eligibility}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
        {selected && (
          <section className="coverage-detail">
            <h2>{selected.streetName}</h2>
            <dl className="coverage-detail-facts">
              <div>
                <dt>Estimated tracts</dt>
                <dd>{selectedContent?.estimatedTracts}</dd>
              </div>
              <div>
                <dt>Road sections</dt>
                <dd>{selected.segments.length}</dd>
              </div>
              <div>
                <dt>Last outreach</dt>
                <dd>
                  {outreachDateSummary(selected.segments.map(({ lastCoveredOn }) => lastCoveredOn))}
                </dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{selectedContent?.eligibility}</dd>
              </div>
            </dl>
            <section aria-labelledby="road-coverage-heading" className="coverage-road-breakdown">
              <h3 id="road-coverage-heading">Coverage along this road</h3>
              <ul>
                {selectedDates.map((group) => (
                  <li key={group.lastCoveredOn ?? 'never'}>
                    <span
                      aria-hidden="true"
                      className={`coverage-road-swatch ${group.coverageClass}`}
                    />
                    <span>
                      <strong>
                        {group.lastCoveredOn ? formatDate(group.lastCoveredOn) : 'Never reached'}
                      </strong>
                      <small>
                        {group.sections} {group.sections === 1 ? 'section' : 'sections'}
                      </small>
                    </span>
                    <span>
                      {group.estimatedTracts} {group.estimatedTracts === 1 ? 'tract' : 'tracts'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </section>
        )}
      </div>
      <section aria-labelledby="current-work-heading" className="current-work">
        <h2 id="current-work-heading">Current work</h2>
        {workState === 'active' ? (
          <div className="current-work-copy">
            <strong>
              <span className="current-work-count">{workspace.activePackets}</span>
              active packet
              {workspace.activePackets === 1 ? '' : 's'} awaiting reconciliation
            </strong>
            <p>
              {workspace.latestBatch
                ? workspace.latestBatch.name.replace(/, \d{1,2}:\d{2} [AP]M$/, '')
                : 'Check which printed sheets are still on the table.'}
            </p>
            <button onClick={onOpenReconciliation} type="button">
              Reconcile packets
            </button>
          </div>
        ) : (
          <div className="current-work-copy">
            <strong>Coverage is ready for another batch.</strong>
            <p>Generate connected packets from the streets that have waited longest.</p>
            <button onClick={onOpenPackets} type="button">
              Generate packets
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}
