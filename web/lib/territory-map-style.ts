import type { BoundaryShape, Position } from './territory-geometry.ts';

export const apartmentLayerIds = [
  'streetlight-apartment-clusters',
  'streetlight-apartment-cluster-count',
  'streetlight-apartments',
  'streetlight-apartment-labels',
] as const;

export function listenForMapStyleLoad(
  map: {
    on: (event: 'style.load', listener: () => void) => unknown;
    off: (event: 'style.load', listener: () => void) => unknown;
  },
  listener: () => void,
): () => void {
  map.on('style.load', listener);
  return () => map.off('style.load', listener);
}

export function keepMapOverlayPublished(
  map: {
    on: (event: 'style.load', listener: () => void) => unknown;
    off: (event: 'style.load', listener: () => void) => unknown;
  },
  publish: () => void,
): () => void {
  publish();
  return listenForMapStyleLoad(map, publish);
}

export function basemapRoadGeometryLayerIds(
  layers: ReadonlyArray<{
    id: string;
    type: string;
    source?: string;
    'source-layer'?: string;
  }>,
): string[] {
  return layers
    .filter(
      (layer) =>
        layer.source === 'openmaptiles' &&
        layer['source-layer'] === 'transportation' &&
        (layer.type === 'line' || layer.type === 'fill'),
    )
    .map(({ id }) => id);
}

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

export const territoryBoundaryStyle = {
  color: mapMarkerStyle.fill,
  opacity: 0.78,
  width: 2,
  dashArray: [3, 2] as const,
  fill: '#eef4ff',
  fillOpacity: 0.04,
};

const territorySegmentColors = {
  included: '#596675',
  excluded: '#aaa7a0',
  hidden: '#6f8794',
};

export function mapPinDataUrl(symbol: 'church' | 'start'): string {
  const symbolMarkup =
    symbol === 'church'
      ? `<path d="M20.8 11.5h2.4v4.7H27v2.4h-3.8v7.9h-2.4v-7.9H17v-2.4h3.8Z" fill="${mapMarkerStyle.outline}"/>`
      : `<circle cx="22" cy="17.5" r="4.6" fill="${mapMarkerStyle.outline}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><path d="M22 7.5c-5.8 0-10.5 4.7-10.5 10.5 0 7.5 10.5 17.6 10.5 17.6S32.5 25.5 32.5 18C32.5 12.2 27.8 7.5 22 7.5Z" fill="${mapMarkerStyle.fill}" stroke="${mapMarkerStyle.outline}" stroke-linejoin="round" stroke-width="2.4"/>${symbolMarkup}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function apartmentMarkerColor(apartment: { includedInPackets: boolean }): string {
  return apartment.includedInPackets ? mapMarkerStyle.fill : '#8f8a80';
}

type ApartmentReviewInput = {
  id: string;
  name: string | null;
  address: string | null;
  position: Position;
  includedInPackets: boolean;
  members: Array<{ apartmentBuilding: boolean }>;
};

type ApartmentReviewSegment = {
  id: string;
  streetName: string;
  geometry: { coordinates: Position[] };
};

function pointToLineDistanceSquared(point: Position, start: Position, end: Position): number {
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos((point[1] * Math.PI) / 180);
  const startX = (start[0] - point[0]) * longitudeScale;
  const startY = (start[1] - point[1]) * latitudeScale;
  const endX = (end[0] - point[0]) * longitudeScale;
  const endY = (end[1] - point[1]) * latitudeScale;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const position = lengthSquared
    ? Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared))
    : 0;
  const nearestX = startX + position * deltaX;
  const nearestY = startY + position * deltaY;
  return nearestX * nearestX + nearestY * nearestY;
}

function nearestNamedRoad(position: Position, segments: ApartmentReviewSegment[]): string | null {
  let nearest: { distance: number; streetName: string } | null = null;
  for (const segment of segments) {
    const streetName = segment.streetName.trim();
    if (!streetName || /^unnamed road$/i.test(streetName)) continue;
    for (let index = 1; index < segment.geometry.coordinates.length; index += 1) {
      const distance = pointToLineDistanceSquared(
        position,
        segment.geometry.coordinates[index - 1],
        segment.geometry.coordinates[index],
      );
      if (!nearest || distance < nearest.distance) nearest = { distance, streetName };
    }
  }
  return nearest?.streetName ?? null;
}

export function apartmentOptionLabel(
  apartment: {
    name: string | null;
    address: string | null;
    includedInPackets: boolean;
    members: Array<{ apartmentBuilding: boolean }>;
  },
  nearbyStreet?: string | null,
): string {
  const status = apartment.includedInPackets ? 'Included' : 'Not included';
  const location =
    apartment.name ??
    apartment.address ??
    (nearbyStreet ? `Address unavailable near ${nearbyStreet}` : 'Address unavailable');
  return `${location} · ${status}`;
}

export function apartmentReviewOptions<T extends ApartmentReviewInput>(
  apartments: T[],
  segments: ApartmentReviewSegment[],
  query: string,
): Array<{
  apartment: T;
  label: string;
  nearbyStreet: string | null;
  disambiguator: string | null;
}> {
  const options = apartments
    .map((apartment) => {
      const nearbyStreet = nearestNamedRoad(apartment.position, segments);
      return {
        apartment,
        nearbyStreet,
        baseLabel: apartmentOptionLabel(apartment, nearbyStreet),
      };
    })
    .sort(
      (left, right) =>
        left.baseLabel.localeCompare(right.baseLabel) ||
        left.apartment.id.localeCompare(right.apartment.id),
    );
  const totals = new Map<string, number>();
  for (const option of options)
    totals.set(option.baseLabel, (totals.get(option.baseLabel) ?? 0) + 1);
  const indexes = new Map<string, number>();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return options
    .map(({ apartment, nearbyStreet, baseLabel }) => {
      const index = (indexes.get(baseLabel) ?? 0) + 1;
      indexes.set(baseLabel, index);
      const disambiguator = totals.get(baseLabel) === 1 ? null : `Building ${index}`;
      return {
        apartment,
        nearbyStreet,
        disambiguator,
        label: disambiguator ? `${baseLabel} · ${disambiguator}` : baseLabel,
      };
    })
    .filter(({ label }) => !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery));
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

export function segmentMapAppearance(segment: SegmentMapInput, selected: boolean) {
  if (segment.manuallyExcluded) {
    return {
      strokeColor: territorySegmentColors.excluded,
      strokeOpacity: selected ? 0.75 : 0.45,
      weightOffset: -1,
      selected,
      selectable: true,
      zIndex: 5,
    };
  }
  if (!segment.active) {
    return {
      strokeColor: territorySegmentColors.hidden,
      strokeOpacity: selected ? 0.75 : 0.48,
      weightOffset: -1,
      selected,
      selectable: true,
      zIndex: selected ? 3 : 1,
    };
  }
  return {
    strokeColor: segment.eligible
      ? territorySegmentColors.included
      : territorySegmentColors.excluded,
    strokeOpacity: selected ? 0.95 : segment.eligible ? 0.8 : 0.45,
    weightOffset: segment.eligible ? 0 : -1,
    selected,
    selectable: segment.eligible || segment.manuallyExcluded,
    zIndex: selected ? 4 : segment.eligible ? 3 : 2,
  };
}
