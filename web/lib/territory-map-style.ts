import type { BoundaryShape, Position } from './territory-geometry.ts';

export const apartmentLayerIds = [
  'streetlight-apartment-clusters',
  'streetlight-apartment-cluster-count',
  'streetlight-apartments',
  'streetlight-apartment-labels',
] as const;

export type ApartmentSelectionSource = 'map' | 'selector';

export function createApartmentSelection(id: string, source: ApartmentSelectionSource) {
  return { id, source };
}

export const coverageColors = {
  red: '#B4473D',
  orange: '#D66B2D',
  yellow: '#D2A128',
  green: '#3E8B65',
  gray: '#77736C',
};

export const mapMarkerStyle = {
  fill: '#123464',
  outline: '#ffffff',
  outlineWidth: 2,
  radius: 12,
  selectedRadius: 15,
};

export function mapPinDataUrl(symbol: 'church' | 'start'): string {
  const symbolMarkup =
    symbol === 'church'
      ? `<path d="M20 11.5h4v4h3.5v4H24v7h-4v-7h-3.5v-4H20Z" fill="${mapMarkerStyle.outline}"/>`
      : `<circle cx="22" cy="17.5" r="4.6" fill="${mapMarkerStyle.outline}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><path d="M22 7.5c-5.8 0-10.5 4.7-10.5 10.5 0 7.5 10.5 17.6 10.5 17.6S32.5 25.5 32.5 18C32.5 12.2 27.8 7.5 22 7.5Z" fill="${mapMarkerStyle.fill}" stroke="${mapMarkerStyle.outline}" stroke-linejoin="round" stroke-width="2.4"/>${symbolMarkup}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function apartmentMarkerColor(status: 'needs_review' | 'ready' | 'deferred'): string {
  void status;
  return mapMarkerStyle.fill;
}

export function apartmentOptionLabel(apartment: {
  address: string | null;
  reviewStatus: 'needs_review' | 'ready' | 'deferred';
  estimatedTracts: number;
}): string {
  const status = {
    needs_review: 'Needs review',
    ready: 'Ready',
    deferred: 'Deferred',
  }[apartment.reviewStatus];
  return `${apartment.address ?? 'Address unavailable'} · ${status} · ${apartment.estimatedTracts} estimated tract${apartment.estimatedTracts === 1 ? '' : 's'}`;
}

export function apartmentFocusZoom(
  source: ApartmentSelectionSource,
  currentZoom: number,
): number | null {
  return source === 'selector' ? Math.max(16, currentZoom) : null;
}

export function apartmentAllowsDrawingPoint(apartmentHit: boolean): boolean {
  return !apartmentHit;
}

export async function expandApartmentCluster(
  source: { getClusterExpansionZoom: (clusterId: number) => Promise<number> },
  clusterId: number,
  center: Position,
  move: (camera: { center: Position; zoom: number }) => void,
): Promise<void> {
  move({ center, zoom: await source.getClusterExpansionZoom(clusterId) });
}

export function boundaryStrokePaths(ring: Position[], shape: BoundaryShape): Position[][] {
  if (shape !== 'square') return [ring];
  const corners = ring.slice(0, -1);
  return corners.map((start, index) => [start, corners[(index + 1) % corners.length]]);
}

export function segmentStrokeWeight(zoom: number): number {
  return Math.min(5, Math.max(2, zoom - 10));
}

type SegmentMapInput = {
  id: string;
  roadGroupId: string;
  active: boolean;
  eligible: boolean;
  manuallyExcluded: boolean;
};

export function segmentVisibleOnMap(
  segment: {
    active: boolean;
    withinBoundary: boolean;
    manuallyExcluded: boolean;
  },
  showHiddenRoads: boolean,
): boolean {
  return segment.withinBoundary && (segment.active || segment.manuallyExcluded || showHiddenRoads);
}

export function segmentMapAppearance(
  segment: SegmentMapInput,
  selectedSegmentId: string | null,
  selectedHiddenRoadGroupId: string | null,
) {
  const selected =
    segment.active || segment.manuallyExcluded
      ? segment.id === selectedSegmentId
      : segment.roadGroupId === selectedHiddenRoadGroupId;
  if (segment.manuallyExcluded) {
    return {
      strokeColor: selected ? '#3f3c37' : '#77736c',
      strokeOpacity: selected ? 0.95 : 0.5,
      weightOffset: selected ? 2 : 0,
      selectable: true,
      zIndex: 5,
    };
  }
  if (!segment.active) {
    return {
      strokeColor: selected ? '#315f72' : '#6f8794',
      strokeOpacity: selected ? 0.8 : 0.38,
      weightOffset: selected ? 2 : -1,
      selectable: true,
      zIndex: selected ? 3 : 1,
    };
  }
  return {
    strokeColor: selected
      ? segment.eligible
        ? '#9a421f'
        : '#3f3c37'
      : segment.eligible
        ? '#df6d32'
        : '#77736c',
    strokeOpacity: selected ? 0.95 : segment.eligible ? 0.65 : 0.5,
    weightOffset: selected ? 2 : 0,
    selectable: segment.eligible || segment.manuallyExcluded,
    zIndex: selected ? 4 : segment.eligible ? 3 : 2,
  };
}
