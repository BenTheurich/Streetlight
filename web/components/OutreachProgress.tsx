'use client';

import { type CSSProperties, type RefObject, useSyncExternalStore } from 'react';
import type { OutreachProgressPeriod, OutreachProgressSnapshot } from '@/lib/outreach-progress';
import type {
  OutreachProgressAction,
  OutreachProgressView,
  OutreachProgressWorkflow,
} from '@/lib/outreach-progress-workflow';
import { APARTMENTS_ENABLED } from '@/lib/product-capabilities';
import { StreetlightSelect } from './StreetlightSelect';

export function WorkspaceProgressPanel({
  workflow,
  ...props
}: {
  active: boolean;
  churchName: string;
  presentationButtonRef: RefObject<HTMLButtonElement | null>;
  workflow: OutreachProgressWorkflow;
}) {
  const view = useSyncExternalStore(workflow.subscribe, workflow.getSnapshot, workflow.getSnapshot);
  return <OutreachProgress {...props} act={workflow.act} view={view} />;
}

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
  act,
  presentationButtonRef,
  view,
}: {
  active: boolean;
  churchName: string;
  act: (action: OutreachProgressAction) => Promise<void>;
  presentationButtonRef: RefObject<HTMLButtonElement | null>;
  view: OutreachProgressView;
}) {
  const {
    displayMode,
    error,
    playing,
    progress,
    position,
    selectedDate,
    snapshot,
    timelinePosition,
    year,
    years,
  } = view;
  const stepCount = progress.dates.length;
  if (displayMode !== 'admin') {
    const completion = stepCount === 0 ? 0 : timelinePosition / stepCount;
    return (
      <aside className="territory-sidebar progress-stage-sidebar" hidden={!active}>
        {displayMode === 'presentation' && (
          <button
            className="progress-presentation-exit secondary"
            onClick={() => void act({ kind: 'exit' })}
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
              onValueChange={(value) =>
                void act({ kind: 'mode', mode: value as 'calendar' | 'rolling' })
              }
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
                onValueChange={(value) => void act({ kind: 'year', year: Number(value) })}
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
                onClick={() => void act({ kind: 'play' })}
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
                onChange={(event) =>
                  void act({ kind: 'position', position: Math.round(Number(event.target.value)) })
                }
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
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            disabled={progress.dates.length === 0}
            onClick={() => void act({ kind: 'present' })}
            ref={presentationButtonRef}
            type="button"
          >
            Present full screen
          </button>
          <button
            className="secondary"
            disabled={progress.dates.length === 0}
            onClick={() => void act({ kind: 'print' })}
            type="button"
          >
            Print progress
          </button>
        </div>
      </div>
    </aside>
  );
}
