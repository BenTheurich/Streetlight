import {
  type BoundaryShape,
  type Polygon,
  type Position,
  polygonIsSimple,
} from './territory-geometry.ts';

export type TerritoryDraftInput = {
  originAddress: string;
  center: Position;
  radiusMiles: number;
  boundaryShape: BoundaryShape;
  activatedRoadGroupIds: string[];
  excludedSegmentIds: string[];
  apartmentStatuses?: Array<{
    id: string;
    reviewStatus: 'needs_review' | 'ready' | 'deferred';
  }>;
  exclusions: Array<{
    id: string;
    name: string;
    enabled: boolean;
    geometry: Polygon;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePosition(value: unknown): Position {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate)) ||
    value[0] < -180 ||
    value[0] > 180 ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    throw new Error('Invalid geographic position');
  }
  return [value[0], value[1]];
}

function parsePolygon(value: unknown): Polygon {
  if (
    !isRecord(value) ||
    value.type !== 'Polygon' ||
    !Array.isArray(value.coordinates) ||
    value.coordinates.length !== 1 ||
    !Array.isArray(value.coordinates[0]) ||
    value.coordinates[0].length < 4 ||
    value.coordinates[0].length > 200
  ) {
    throw new Error('Invalid exclusion polygon');
  }
  const polygon: Polygon = {
    type: 'Polygon',
    coordinates: [value.coordinates[0].map(parsePosition)],
  };
  const ring = polygon.coordinates[0];
  if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) {
    throw new Error('Exclusion polygon must be closed');
  }
  if (!polygonIsSimple(polygon)) {
    throw new Error('Exclusion polygon must not self-intersect');
  }
  return polygon;
}

function parseText(
  value: unknown,
  label: string,
  maximumLength: number,
  required: boolean,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is invalid`);
  }
  const text = value.trim();
  if ((required && text.length === 0) || text.length > maximumLength) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

export function parseTerritoryDraft(value: unknown): TerritoryDraftInput {
  if (!isRecord(value)) {
    throw new Error('Invalid territory draft');
  }
  if (
    typeof value.radiusMiles !== 'number' ||
    !Number.isFinite(value.radiusMiles) ||
    value.radiusMiles < 1 ||
    value.radiusMiles > 20
  ) {
    throw new Error('Boundary distance must be between 1 and 20 miles');
  }
  if (value.boundaryShape !== 'circle' && value.boundaryShape !== 'square') {
    throw new Error('Boundary shape is invalid');
  }
  if (!Array.isArray(value.exclusions) || value.exclusions.length > 100) {
    throw new Error('Invalid exclusion areas');
  }
  if (!Array.isArray(value.activatedRoadGroupIds) || value.activatedRoadGroupIds.length > 1000) {
    throw new Error('Invalid activated roads');
  }
  if (!Array.isArray(value.excludedSegmentIds) || value.excludedSegmentIds.length > 10_000) {
    throw new Error('Invalid excluded segments');
  }
  if (
    value.apartmentStatuses !== undefined &&
    (!Array.isArray(value.apartmentStatuses) || value.apartmentStatuses.length > 10_000)
  ) {
    throw new Error('Invalid apartment statuses');
  }

  const ids = new Set<string>();
  const exclusions = value.exclusions.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error('Invalid exclusion area');
    }
    const id = parseText(candidate.id, 'Exclusion ID', 100, true);
    if (ids.has(id)) {
      throw new Error('Duplicate exclusion ID');
    }
    if (typeof candidate.enabled !== 'boolean') {
      throw new Error('Exclusion enabled state is invalid');
    }
    ids.add(id);
    return {
      id,
      name: parseText(candidate.name, 'Exclusion name', 100, false),
      enabled: candidate.enabled,
      geometry: parsePolygon(candidate.geometry),
    };
  });
  const roadGroupIds = new Set<string>();
  const activatedRoadGroupIds = value.activatedRoadGroupIds.map((candidate) => {
    const id = parseText(candidate, 'Road group ID', 200, true);
    if (roadGroupIds.has(id)) {
      throw new Error('Duplicate road group ID');
    }
    roadGroupIds.add(id);
    return id;
  });
  const segmentIds = new Set<string>();
  const excludedSegmentIds = value.excludedSegmentIds.map((candidate) => {
    const id = parseText(candidate, 'Segment ID', 200, true);
    if (segmentIds.has(id)) {
      throw new Error('Duplicate segment ID');
    }
    segmentIds.add(id);
    return id;
  });
  const apartmentIds = new Set<string>();
  const apartmentStatuses = (value.apartmentStatuses ?? []).map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error('Invalid apartment status');
    }
    const id = parseText(candidate.id, 'Apartment ID', 200, true);
    if (
      apartmentIds.has(id) ||
      !['needs_review', 'ready', 'deferred'].includes(String(candidate.reviewStatus))
    ) {
      throw new Error('Invalid apartment status');
    }
    apartmentIds.add(id);
    return {
      id,
      reviewStatus: candidate.reviewStatus as 'needs_review' | 'ready' | 'deferred',
    };
  });

  return {
    originAddress: parseText(value.originAddress, 'Church address', 300, true),
    center: parsePosition(value.center),
    radiusMiles: value.radiusMiles,
    boundaryShape: value.boundaryShape,
    activatedRoadGroupIds,
    excludedSegmentIds,
    apartmentStatuses,
    exclusions,
  };
}
