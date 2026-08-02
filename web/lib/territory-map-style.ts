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

export function apartmentMarkerColor(status: 'needs_review' | 'ready' | 'deferred'): string {
  void status;
  return '#34445a';
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
