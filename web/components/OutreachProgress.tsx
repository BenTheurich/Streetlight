'use client';

import type { CSSProperties } from 'react';
import type { OutreachProgressPeriod, OutreachProgressSnapshot } from '@/lib/outreach-progress';

export type ProgressDisplayMode = 'admin' | 'presentation' | 'print';

function formatDate(value: string | null, year: number): string {
  if (!value) return `Beginning of ${year}`;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function Metrics({ snapshot }: { snapshot: OutreachProgressSnapshot }) {
  return (
    <dl className="progress-metrics">
      <div>
        <dt>Completed packets</dt>
        <dd>{snapshot.completedPackets.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Street sections</dt>
        <dd>{snapshot.streetSections.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Apartment complexes</dt>
        <dd>{snapshot.apartmentComplexes.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Estimated homes</dt>
        <dd>{snapshot.estimatedHomes.toLocaleString()}</dd>
      </div>
    </dl>
  );
}

export function OutreachProgress({
  active,
  churchName,
  displayMode,
  onDisplayModeChange,
  onPlay,
  onPrint,
  onStepChange,
  onYearChange,
  playing,
  progress,
  snapshot,
  step,
  through,
  year,
  years,
}: {
  active: boolean;
  churchName: string;
  displayMode: ProgressDisplayMode;
  onDisplayModeChange: (mode: ProgressDisplayMode) => void;
  onPlay: () => void;
  onPrint: () => void;
  onStepChange: (step: number) => void;
  onYearChange: (year: number) => void;
  playing: boolean;
  progress: OutreachProgressPeriod;
  snapshot: OutreachProgressSnapshot;
  step: number;
  through: string | null;
  year: number;
  years: number[];
}) {
  if (displayMode !== 'admin') {
    const completion = progress.dates.length === 0 ? 0 : (step / progress.dates.length) * 100;
    return (
      <aside className="territory-sidebar progress-stage-sidebar" hidden={!active}>
        {displayMode === 'presentation' && (
          <button
            className="progress-presentation-exit secondary"
            onClick={() => onDisplayModeChange('admin')}
            type="button"
          >
            Exit presentation
          </button>
        )}
        <div className="progress-stage-copy">
          <h1>{year} outreach</h1>
          <p>{churchName}</p>
          <Metrics snapshot={snapshot} />
          <div className="progress-stage-timeline">
            <strong aria-live="polite">{formatDate(through, year)}</strong>
            <span>{snapshot.outreachDays} outreach days recorded</span>
            <div aria-hidden="true">
              <span style={{ '--progress-completion': `${completion}%` } as CSSProperties} />
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="territory-sidebar outreach-progress-sidebar" hidden={!active}>
      <div className="sidebar-scroll">
        <section className="progress-intro">
          <h1>{year} outreach progress</h1>
          <p>Replay the outreach Streetlight has actually recorded across the territory.</p>
        </section>
        <label className="coverage-field" htmlFor="progress-period">
          Time period
          <select
            id="progress-period"
            onChange={(event) => onYearChange(Number(event.target.value))}
            value={year}
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <section>
          <h2>Recorded through {formatDate(through, year)}</h2>
          <Metrics snapshot={snapshot} />
        </section>
        <section className="progress-playback">
          <h2>Yearly playback</h2>
          {progress.dates.length === 0 ? (
            <p className="empty-state">No completed outreach is recorded for {year}.</p>
          ) : (
            <>
              <input
                aria-label="Outreach playback date"
                max={progress.dates.length}
                min="0"
                onChange={(event) => onStepChange(Number(event.target.value))}
                type="range"
                value={step}
              />
              <p aria-live="polite">{formatDate(through, year)}</p>
            </>
          )}
        </section>
      </div>
      <div className="sidebar-actions progress-actions">
        <div>
          <button disabled={progress.dates.length === 0} onClick={onPlay} type="button">
            {playing ? 'Restart playback' : 'Play year'}
          </button>
          <button
            className="secondary"
            onClick={() => onDisplayModeChange('presentation')}
            type="button"
          >
            Present full screen
          </button>
        </div>
        <button className="secondary" onClick={onPrint} type="button">
          Print progress
        </button>
      </div>
    </aside>
  );
}
