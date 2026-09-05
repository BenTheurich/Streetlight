'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import type { MapCamera } from '@/lib/map-camera';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import { createOutreachProgressWorkflow } from '@/lib/outreach-progress-workflow';

export function useOutreachProgress({
  active,
  coverage,
  camera,
  lifecycle,
  onCameraChange,
}: {
  active: boolean;
  coverage: CoverageWorkspace;
  camera: MapCamera;
  lifecycle: MapOverlayLifecycle | null;
  onCameraChange: (camera: MapCamera) => void;
}) {
  const presentationButtonRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef({ camera, onCameraChange });
  currentRef.current = { camera, onCameraChange };
  const printCommitRef = useRef<{
    signal: AbortSignal;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const [workflow] = useState(() =>
    createOutreachProgressWorkflow(coverage, {
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (frame) => cancelAnimationFrame(frame),
      observe(events) {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const changed = () => events.reducedMotion(query.matches);
        const closeOnEscape = (event: KeyboardEvent) => {
          if (event.key === 'Escape' && !document.fullscreenElement) events.exit();
        };
        const fullscreen = () => {
          if (!document.fullscreenElement) events.exit();
        };
        changed();
        query.addEventListener('change', changed);
        window.addEventListener('keydown', closeOnEscape);
        document.addEventListener('fullscreenchange', fullscreen);
        return () => {
          query.removeEventListener('change', changed);
          window.removeEventListener('keydown', closeOnEscape);
          document.removeEventListener('fullscreenchange', fullscreen);
        };
      },
      enterFullscreen: async () => {
        await document.documentElement.requestFullscreen?.();
      },
      exitFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
      },
      focusPresentation: () => requestAnimationFrame(() => presentationButtonRef.current?.focus()),
      getCamera: () => currentRef.current.camera,
      restoreCamera: (original) => currentRef.current.onCameraChange(original),
      preparePrint(signal) {
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            printCommitRef.current = null;
            reject(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          printCommitRef.current = {
            signal,
            resolve: () => {
              signal.removeEventListener('abort', abort);
              resolve();
            },
            reject: (error) => {
              signal.removeEventListener('abort', abort);
              reject(error);
            },
          };
        });
      },
      print(signal) {
        return new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            window.removeEventListener('afterprint', finished);
            signal.removeEventListener('abort', aborted);
          };
          const finished = () => {
            cleanup();
            resolve();
          };
          const aborted = () => {
            cleanup();
            reject(signal.reason);
          };
          window.addEventListener('afterprint', finished);
          signal.addEventListener('abort', aborted, { once: true });
          try {
            window.print();
          } catch (error) {
            cleanup();
            reject(error);
          }
        });
      },
    }),
  );
  const displayMode = useSyncExternalStore(
    workflow.subscribe,
    workflow.getDisplayMode,
    workflow.getDisplayMode,
  );
  useEffect(() => workflow.start(), [workflow]);
  useEffect(() => workflow.update(coverage), [coverage, workflow]);
  useEffect(() => {
    if (!active) void workflow.act({ kind: 'exit' });
  }, [active, workflow]);
  useEffect(() => {
    const commit = printCommitRef.current;
    if (displayMode !== 'print' || !commit) return;
    printCommitRef.current = null;
    if (!lifecycle) {
      commit.reject(new Error('The map is unavailable'));
      return;
    }
    // Child overlay effects have published the fitted print presentation for this committed layout.
    void lifecycle.whenSettled(commit.signal).then(commit.resolve, commit.reject);
  }, [lifecycle, displayMode]);
  return { workflow, displayMode, act: workflow.act, presentationButtonRef };
}
