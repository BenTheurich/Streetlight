import { type Polygon, type Position, polygonIsSimple } from './territory-geometry.ts';

export type TerritoryDraftInput = {
  originAddress: string;
  center: Position;
  radiusMiles: number;
  activatedRoadGroupIds: string[];
  exclusions: Array<{
    id: string;
    name: string;
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
    throw new Error('Radius must be between 1 and 20 miles');
  }
  if (!Array.isArray(value.exclusions) || value.exclusions.length > 100) {
    throw new Error('Invalid exclusion areas');
  }
  if (!Array.isArray(value.activatedRoadGroupIds) || value.activatedRoadGroupIds.length > 1000) {
    throw new Error('Invalid activated roads');
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
    ids.add(id);
    return {
      id,
      name: parseText(candidate.name, 'Exclusion name', 100, false),
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

  return {
    originAddress: parseText(value.originAddress, 'Church address', 300, true),
    center: parsePosition(value.center),
    radiusMiles: value.radiusMiles,
    activatedRoadGroupIds,
    exclusions,
  };
}
