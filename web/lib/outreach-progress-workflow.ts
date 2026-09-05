import type { CoverageWorkspace } from './coverage.ts';
import type { MapCamera } from './map-camera.ts';
import {
  buildOutreachProgress,
  type OutreachProgressMode,
  outreachProgressPlayback,
  outreachProgressSnapshot,
  outreachProgressYears,
} from './outreach-progress.ts';

export type ProgressDisplayMode = 'admin' | 'presentation' | 'print';
export type OutreachProgressAction =
  | { kind: 'year'; year: number }
  | { kind: 'mode'; mode: OutreachProgressMode }
  | { kind: 'position'; position: number }
  | { kind: 'play' }
  | { kind: 'present' }
  | { kind: 'exit' }
  | { kind: 'print' };

export type ProgressBrowser = {
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (frame: number) => void;
  observe: (events: { reducedMotion: (value: boolean) => void; exit: () => void }) => () => void;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  focusPresentation: () => void;
  getCamera: () => MapCamera;
  restoreCamera: (camera: MapCamera) => void;
  preparePrint: (signal: AbortSignal) => Promise<void>;
  print: (signal: AbortSignal) => Promise<void>;
};

export function createOutreachProgressWorkflow(
  initial: CoverageWorkspace,
  browser: ProgressBrowser,
) {
  const listeners = new Set<() => void>();
  let coverage = initial;
  let years = outreachProgressYears(coverage);
  let year = years[0];
  let mode: OutreachProgressMode = 'calendar';
  let progress = buildOutreachProgress(coverage, year);
  let position: number | null = null;
  let playing = false;
  let reducedMotion = false;
  let displayMode: ProgressDisplayMode = 'admin';
  let error = '';
  let frame: number | null = null;
  let previousFrame: number | null = null;
  let restStarted: number | null = null;
  let printAttempt: { controller: AbortController; camera: MapCamera } | null = null;
  let presentationAttempt = 0;
  let snapshotProgress = progress;
  let snapshotThrough: string | null = null;
  let metrics = outreachProgressSnapshot(progress, null);

  function buildSnapshot() {
    const resolvedPosition = Math.min(position ?? progress.dates.length, progress.dates.length);
    const playback = outreachProgressPlayback(progress, resolvedPosition);
    if (snapshotProgress !== progress || snapshotThrough !== playback.through) {
      metrics = outreachProgressSnapshot(progress, playback.through);
      snapshotProgress = progress;
      snapshotThrough = playback.through;
    }
    return {
      displayMode,
      error,
      playing,
      position: resolvedPosition,
      progress,
      reducedMotion,
      selectedDate: playback.selectedDate,
      snapshot: metrics,
      timelinePosition: playback.barPosition,
      year,
      years,
    };
  }
  let snapshot = buildSnapshot();

  function publish() {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function stop() {
    playing = false;
    if (frame !== null) browser.cancelFrame(frame);
    frame = null;
    previousFrame = null;
    restStarted = null;
  }

  function tick(time: number) {
    frame = null;
    if (!playing) return;
    previousFrame ??= time;
    const elapsed = Math.min(time - previousFrame, 100);
    if (elapsed >= 30) {
      previousFrame = time;
      const previousPosition = position;
      const wasPlaying = playing;
      if ((position ?? progress.dates.length) >= progress.dates.length) {
        if (displayMode !== 'presentation') stop();
        else {
          restStarted ??= time;
          if (time - restStarted >= 4000) {
            position = 0;
            restStarted = null;
          }
        }
      } else position = Math.min(progress.dates.length, (position ?? 0) + elapsed / 2250);
      if (position !== previousPosition || playing !== wasPlaying) publish();
    }
    if (playing) frame = browser.requestFrame(tick);
  }

  function play() {
    if (playing) stop();
    else if (progress.dates.length > 0 && !reducedMotion) {
      if ((position ?? progress.dates.length) >= progress.dates.length) position = 0;
      playing = true;
      frame = browser.requestFrame(tick);
    } else position = null;
  }

  function finishPrint() {
    const attempt = printAttempt;
    if (!attempt) return;
    printAttempt = null;
    attempt.controller.abort();
    displayMode = 'admin';
    publish();
    browser.restoreCamera(attempt.camera);
  }

  function exit() {
    presentationAttempt += 1;
    const presenting = displayMode === 'presentation';
    stop();
    if (displayMode !== 'admin') position = null;
    finishPrint();
    displayMode = 'admin';
    if (presenting) {
      void browser.exitFullscreen().catch(() => undefined);
      browser.focusPresentation();
    }
    publish();
  }

  async function print() {
    if (printAttempt || progress.dates.length === 0) return;
    stop();
    position = null;
    error = '';
    const attempt = { controller: new AbortController(), camera: browser.getCamera() };
    printAttempt = attempt;
    // Register before publishing so the React adapter can acknowledge the committed paper layout.
    const prepared = browser.preparePrint(attempt.controller.signal);
    displayMode = 'print';
    publish();
    try {
      await prepared;
      if (!attempt.controller.signal.aborted) await browser.print(attempt.controller.signal);
    } catch {
      if (!attempt.controller.signal.aborted) {
        error = 'The progress map could not finish loading. Try printing again.';
      }
    } finally {
      if (printAttempt === attempt) finishPrint();
    }
  }

  return {
    getSnapshot: () => snapshot,
    getDisplayMode: () => snapshot.displayMode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const unobserve = browser.observe({
        reducedMotion(value) {
          reducedMotion = value;
          if (value) {
            stop();
            position = null;
          }
          publish();
        },
        exit,
      });
      return () => {
        unobserve();
        exit();
      };
    },
    update(next: CoverageWorkspace) {
      if (coverage === next) return;
      coverage = next;
      years = outreachProgressYears(coverage);
      progress = buildOutreachProgress(coverage, mode === 'calendar' ? year : 'rolling');
      if (progress.dates.length === 0) stop();
      publish();
    },
    async act(action: OutreachProgressAction) {
      if (action.kind === 'exit') return exit();
      if (printAttempt) return;
      error = '';
      switch (action.kind) {
        case 'year':
        case 'mode':
          stop();
          if (action.kind === 'year') year = action.year;
          else mode = action.mode;
          progress = buildOutreachProgress(coverage, mode === 'calendar' ? year : 'rolling');
          position = null;
          break;
        case 'position':
          stop();
          position = Math.max(0, Math.min(action.position, progress.dates.length));
          break;
        case 'play':
          play();
          break;
        case 'present':
          if (progress.dates.length === 0) return;
          stop();
          displayMode = 'presentation';
          position = null;
          play();
          // Fullscreen can be denied; the same composition still works until Escape is pressed.
          {
            const attempt = ++presentationAttempt;
            void browser
              .enterFullscreen()
              .then(() => {
                if (attempt !== presentationAttempt && displayMode !== 'presentation') {
                  void browser.exitFullscreen().catch(() => undefined);
                }
              })
              .catch(() => undefined);
          }
          break;
        case 'print':
          return print();
      }
      publish();
    },
  };
}

export type OutreachProgressWorkflow = ReturnType<typeof createOutreachProgressWorkflow>;
export type OutreachProgressView = ReturnType<OutreachProgressWorkflow['getSnapshot']>;
