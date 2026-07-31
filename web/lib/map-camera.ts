import type { Position } from './territory-geometry.ts';

export type MapCamera = {
  center: Position;
  zoom: number;
};

export function googleZoomToMapLibre(zoom: number): number {
  return zoom - 1;
}

export function mapLibreZoomToGoogle(zoom: number): number {
  return zoom + 1;
}

export function mergeMapCamera(current: MapCamera, next: MapCamera): MapCamera {
  return Math.abs(current.center[0] - next.center[0]) < 1e-7 &&
    Math.abs(current.center[1] - next.center[1]) < 1e-7 &&
    Math.abs(current.zoom - next.zoom) < 0.01
    ? current
    : next;
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
