import type { BoundaryShape, Position } from './territory-geometry.ts';

export type TerritoryDraftInput = {
  originAddress: string;
  center: Position;
  radiusMiles: number;
  boundaryShape: BoundaryShape;
  activatedSegmentIds: string[];
  excludedSegmentIds: string[];
  apartmentStatuses?: Array<{
    id: string;
    reviewStatus: 'needs_review' | 'ready' | 'deferred';
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

function parseUniqueSegmentIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error(`Invalid ${label.toLowerCase()}s`);
  }
  const ids = new Set<string>();
  return value.map((candidate) => {
    const id = parseText(candidate, 'Segment ID', 200, true);
    if (ids.has(id)) {
      throw new Error(`Duplicate ${label.toLowerCase()} ID`);
    }
    ids.add(id);
    return id;
  });
}

export function parseTerritoryDraft(value: unknown): TerritoryDraftInput {
  if (!isRecord(value)) {
    throw new Error('Invalid region draft');
  }
  if (
    typeof value.radiusMiles !== 'number' ||
    !Number.isFinite(value.radiusMiles) ||
    value.radiusMiles < 1 ||
    value.radiusMiles > 5
  ) {
    throw new Error('Boundary distance must be between 1 and 5 miles');
  }
  if (value.boundaryShape !== 'circle' && value.boundaryShape !== 'square') {
    throw new Error('Boundary shape is invalid');
  }
  if (
    value.apartmentStatuses !== undefined &&
    (!Array.isArray(value.apartmentStatuses) || value.apartmentStatuses.length > 10_000)
  ) {
    throw new Error('Invalid apartment statuses');
  }

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
    activatedSegmentIds: parseUniqueSegmentIds(value.activatedSegmentIds, 'activated segment'),
    excludedSegmentIds: parseUniqueSegmentIds(value.excludedSegmentIds, 'excluded segment'),
    apartmentStatuses,
  };
}
