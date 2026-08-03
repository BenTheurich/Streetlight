import type { Position } from './territory-geometry.ts';

export type MapCamera = {
  center: Position;
  zoom: number;
};

export type CoverageSelectionSource = 'map' | 'search';

export type WorkspaceMapTransition = 'none' | 'create' | 'remove' | 'restyle';

export function workspaceMapTransition(
  hasMap: boolean,
  hasData: boolean,
  dataChanged: boolean,
  mapTypeChanged: boolean,
): WorkspaceMapTransition {
  if (!hasMap) return hasData ? 'create' : 'none';
  if (!hasData) return 'remove';
  return dataChanged || mapTypeChanged ? 'restyle' : 'none';
}

export function coverageSelectionCameraOptions(
  _source: CoverageSelectionSource,
  reducedMotion: boolean,
): {
  padding: { top: number; right: number; bottom: number; left: number };
  maxZoom: number;
  duration: number;
} {
  return {
    padding: { top: 64, right: 96, bottom: 64, left: 64 },
    maxZoom: 16,
    duration: reducedMotion ? 0 : 220,
  };
}

export function googleZoomToMapLibre(zoom: number): number {
  return zoom - 1;
}

export function mapLibreZoomToGoogle(zoom: number): number {
  return zoom + 1;
}

export function mapLoadErrorIsFatal(loaded: boolean): boolean {
  return !loaded;
}

export function mergeMapCamera(current: MapCamera, next: MapCamera): MapCamera {
  return Math.abs(current.center[0] - next.center[0]) < 1e-7 &&
    Math.abs(current.center[1] - next.center[1]) < 1e-7 &&
    Math.abs(current.zoom - next.zoom) < 0.01
    ? current
    : next;
}

export function forwardMapCameraChange(
  current: MapCamera,
  next: MapCamera,
  publish: (camera: MapCamera) => void,
): MapCamera {
  const merged = mergeMapCamera(current, next);
  if (merged !== current) publish(merged);
  return merged;
}

export function isReflectedMapCamera(published: MapCamera | null, incoming: MapCamera): boolean {
  return published !== null && mergeMapCamera(published, incoming) === published;
}

export function positionBounds(positions: Position[]): [[number, number], [number, number]] | null {
  if (positions.length === 0) return null;
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
