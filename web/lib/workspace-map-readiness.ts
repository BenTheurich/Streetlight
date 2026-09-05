import type { StreetlightMapType } from './google-maps-browser.ts';
import type { MapOverlayLifecycle } from './map-overlay-lifecycle.ts';

export function createSatelliteMapReadiness() {
  let state: 'loading' | 'ready' | 'error' = 'loading';
  const listeners = new Set<() => void>();
  const change = (next: typeof state) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    observe(map: Pick<google.maps.Map, 'addListener'>) {
      change('loading');
      const moving = map.addListener('bounds_changed', () => change('loading'));
      const loaded = map.addListener('tilesloaded', () => change('ready'));
      return () => {
        moving.remove();
        loaded.remove();
        change('error');
      };
    },
    fail: () => change('error'),
    wait(signal: AbortSignal) {
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          listeners.delete(check);
          signal.removeEventListener('abort', check);
        };
        const check = () => {
          if (signal.aborted || state === 'error') {
            cleanup();
            reject(signal.reason ?? new Error('Google satellite map could not load.'));
          } else if (state === 'ready') {
            cleanup();
            resolve();
          }
        };
        listeners.add(check);
        signal.addEventListener('abort', check, { once: true });
        check();
      });
    },
  };
}

export async function waitForWorkspaceMap(
  openMap: Pick<MapOverlayLifecycle, 'whenSettled'>,
  mapType: () => StreetlightMapType,
  satellite: ReturnType<typeof createSatelliteMapReadiness>,
  signal: AbortSignal,
) {
  // Match the packet renderer's maximum map-capture wait, while preserving Escape cancellation.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  await openMap.whenSettled(bounded);
  if (mapType() === 'satellite') await satellite.wait(bounded);
}
