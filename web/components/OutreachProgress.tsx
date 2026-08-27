'use client';

import type { CSSProperties, RefObject } from 'react';
import type {
  OutreachProgressMode,
  OutreachProgressPeriod,
  OutreachProgressSnapshot,
} from '@/lib/outreach-progress';
import { APARTMENTS_ENABLED } from '@/lib/product-capabilities';
import { StreetlightSelect } from './StreetlightSelect';

export type ProgressDisplayMode = 'admin' | 'presentation' | 'print';

function formatDate(value: string | null, progress: OutreachProgressPeriod): string {
  if (!value) {
    return progress.mode === 'calendar'
      ? `Beginning of ${progress.year}`
      : 'Beginning of the past year';
  }
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
        <dt>Streets</dt>
        <dd>{snapshot.streets.toLocaleString()}</dd>
      </div>
      {APARTMENTS_ENABLED && (
        <div>
          <dt>Apartment complexes</dt>
          <dd>{snapshot.apartmentComplexes.toLocaleString()}</dd>
        </div>
      )}
      <div>
        <dt>Estimated homes reached</dt>
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
  onModeChange,
  onPlay,
  onPrint,
  onStepChange,
  onYearChange,
  playing,
  presentationButtonRef,
  progress,
  position,
  stepCount,
  selectedDate,
  snapshot,
  timelinePosition,
  year,
  years,
}: {
  active: boolean;
  churchName: string;
  displayMode: ProgressDisplayMode;
  onDisplayModeChange: (mode: ProgressDisplayMode) => void;
  onModeChange: (mode: OutreachProgressMode) => void;
  onPlay: () => void;
  onPrint: () => void;
  onStepChange: (step: number) => void;
  onYearChange: (year: number) => void;
  playing: boolean;
  presentationButtonRef: RefObject<HTMLButtonElement | null>;
  progress: OutreachProgressPeriod;
  position: number;
  stepCount: number;
  selectedDate: string | null;
  snapshot: OutreachProgressSnapshot;
  timelinePosition: number;
  year: number;
  years: number[];
}) {
  if (displayMode !== 'admin') {
    const completion = stepCount === 0 ? 0 : timelinePosition / stepCount;
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
          <h1>{progress.mode === 'calendar' ? `${year} outreach` : 'Past year'}</h1>
          <p>{churchName}</p>
          <Metrics snapshot={snapshot} />
          <div className="progress-stage-timeline">
            <strong aria-live={playing ? 'off' : 'polite'}>
              {displayMode === 'print'
                ? `Progress through ${formatDate(selectedDate, progress)}`
                : formatDate(selectedDate, progress)}
            </strong>
            <span>
              {snapshot.outreachDays} outreach {snapshot.outreachDays === 1 ? 'day' : 'days'}{' '}
              recorded
            </span>
            {displayMode !== 'print' && (
              <div aria-hidden="true">
                <span style={{ '--progress-completion': completion } as CSSProperties} />
              </div>
            )}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="territory-sidebar outreach-progress-sidebar" hidden={!active}>
      <div className="sidebar-scroll">
        <section className="progress-intro">
          <h1>{progress.mode === 'calendar' ? `${year} outreach progress` : 'Past year'}</h1>
          <p>See how completed outreach spread across your region over time.</p>
        </section>
        <div className="progress-period-fields">
          <label className="coverage-field" htmlFor="progress-mode">
            View
            <StreetlightSelect
              ariaLabel="View"
              id="progress-mode"
              onValueChange={(value) => onModeChange(value as OutreachProgressMode)}
              options={[
                { label: 'Calendar year', value: 'calendar' },
                { label: 'Past year', value: 'rolling' },
              ]}
              value={progress.mode}
            />
          </label>
          {progress.mode === 'calendar' && (
            <label className="coverage-field" htmlFor="progress-period">
              Year
              <StreetlightSelect
                ariaLabel="Year"
                id="progress-period"
                onValueChange={(value) => onYearChange(Number(value))}
                options={years.map((value) => ({ label: String(value), value: String(value) }))}
                value={String(year)}
              />
            </label>
          )}
        </div>
        <section>
          <h2>
            {selectedDate
              ? `Progress as of ${formatDate(selectedDate, progress)}`
              : progress.mode === 'calendar'
                ? `Recorded outreach in ${year}`
                : 'Recorded outreach in the past year'}
          </h2>
          <Metrics snapshot={snapshot} />
        </section>
        <section className="progress-playback">
          <h2>Playback</h2>
          {progress.dates.length === 0 ? (
            <p className="empty-state">No completed outreach is recorded for this period.</p>
          ) : (
            <div className="progress-playback-controls">
              <button
                aria-label={
                  playing
                    ? 'Pause playback'
                    : position > 0 && position < stepCount
                      ? 'Resume playback'
                      : progress.mode === 'calendar'
                        ? `Play ${year}`
                        : 'Play past year'
                }
                className="progress-playback-toggle"
                onClick={onPlay}
                type="button"
              >
                {playing ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m8 5 11 7-11 7z" />
                  </svg>
                )}
              </button>
              <input
                aria-label="Outreach playback date"
                aria-valuetext={formatDate(selectedDate, progress)}
                max={stepCount}
                min="0"
                onChange={(event) => onStepChange(Math.round(Number(event.target.value)))}
                step="any"
                type="range"
                value={position}
              />
              <p className="progress-playback-date" aria-live={playing ? 'off' : 'polite'}>
                {formatDate(selectedDate, progress)}
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="sidebar-actions progress-actions">
        <div>
          <button
            disabled={progress.dates.length === 0}
            onClick={() => onDisplayModeChange('presentation')}
            ref={presentationButtonRef}
            type="button"
          >
            Present full screen
          </button>
          <button
            className="secondary"
            disabled={progress.dates.length === 0}
            onClick={onPrint}
            type="button"
          >
            Print progress
          </button>
        </div>
      </div>
    </aside>
  );
}
