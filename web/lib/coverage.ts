import type { Position } from './territory-geometry.ts';
import type { ApartmentSite, TerritorySegment } from './territory-workspace.ts';

export type CoverageClass = 'red' | 'orange' | 'yellow' | 'green';

export type CoverageThresholds = {
  yellowAfterDays: number;
  orangeAfterDays: number;
  redAfterDays: number;
};

export type CoverageLegendItem = {
  coverageClass: CoverageClass | 'gray';
  label: string;
};

export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
  yellowAfterDays: 90,
  orangeAfterDays: 180,
  redAfterDays: 365,
};

export type CoverageCorrection = {
  id: string;
  sequence: number;
  coveredOn: string;
  isVoid: boolean;
};

export type CoverageRoot = {
  eventId: string;
  packetId: string | null;
  originalCoveredOn: string;
  effectiveCoveredOn: string | null;
  corrections: CoverageCorrection[];
};

export type CoverageWorkspaceSegment = Pick<
  TerritorySegment,
  | 'id'
  | 'roadGroupId'
  | 'streetName'
  | 'geometry'
  | 'estimatedHomes'
  | 'eligible'
  | 'excludedReason'
> & {
  lastCoveredOn: string | null;
  coverageClass: CoverageClass;
  roots: CoverageRoot[];
};

export type CoverageWorkspaceApartment = ApartmentSite & {
  lastCoveredOn: string | null;
  coverageClass: CoverageClass;
  roots: CoverageRoot[];
};

export type CoverageWorkspace = {
  id: string;
  churchName: string;
  name: string;
  center: Position;
  asOf: string;
  activePackets: number;
  latestBatch: {
    id: string;
    name: string;
    packetCount: number;
    estimatedHomes: number;
  } | null;
  thresholds: CoverageThresholds;
  legend: CoverageLegendItem[];
  dataMode: 'canonical' | 'demo';
  qualityWarnings: string[];
  apartmentComplexes: CoverageWorkspaceApartment[];
  segments: CoverageWorkspaceSegment[];
  totals: { eligibleHomes: number };
};

export type CoverageSegmentInput = {
  id: string;
  estimatedHomes: number;
  eligible: boolean;
};

type CoverageRoadSegment = {
  id: string;
  roadGroupId: string;
  streetName: string;
  geometry?: { coordinates: Array<[number, number]> };
};

type CoverageSearchableSegment = CoverageRoadSegment & {
  estimatedHomes: number;
  lastCoveredOn: string | null;
  eligible: boolean;
  coverageClass: CoverageClass;
};

export type CoverageRoad<T extends CoverageRoadSegment = CoverageSearchableSegment> = {
  roadGroupId: string;
  streetName: string;
  segments: T[];
};

export function coverageStreetName(streetName: string): string {
  return streetName.trim() || 'Unnamed road';
}

const ROAD_CARRIAGEWAY_JOIN_METERS = 35;

function pointToLineDistanceSquared(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
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

function linesAreNearby(first: Array<[number, number]>, second: Array<[number, number]>): boolean {
  const limit = ROAD_CARRIAGEWAY_JOIN_METERS ** 2;
  const near = (points: Array<[number, number]>, line: Array<[number, number]>) =>
    points.some((point) =>
      line
        .slice(1)
        .some((end, index) => pointToLineDistanceSquared(point, line[index], end) <= limit),
    );
  return near(first, second) || near(second, first);
}

export function coverageRoads<T extends CoverageRoadSegment>(segments: T[]): CoverageRoad<T>[] {
  const sourceRoads = new Map<string, CoverageRoad<T> & { sourceIndex: number }>();
  for (const [sourceIndex, segment] of segments.entries()) {
    const road = sourceRoads.get(segment.roadGroupId);
    if (road) road.segments.push(segment);
    else {
      sourceRoads.set(segment.roadGroupId, {
        roadGroupId: segment.roadGroupId,
        streetName: coverageStreetName(segment.streetName),
        segments: [segment],
        sourceIndex,
      });
    }
  }
  const roads = [...sourceRoads.values()];
  const parents = roads.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };
  const join = (first: number, second: number) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };
  for (let first = 0; first < roads.length; first += 1) {
    const name = roads[first].streetName.trim().toLocaleLowerCase();
    if (name === 'unnamed road') continue;
    for (let second = first + 1; second < roads.length; second += 1) {
      if (roads[second].streetName.trim().toLocaleLowerCase() !== name) continue;
      if (
        roads[first].segments.some((a) =>
          roads[second].segments.some(
            (b) =>
              a.geometry &&
              b.geometry &&
              linesAreNearby(a.geometry.coordinates, b.geometry.coordinates),
          ),
        )
      ) {
        join(first, second);
      }
    }
  }
  const merged = new Map<number, CoverageRoad<T> & { sourceIndex: number }>();
  for (const [index, road] of roads.entries()) {
    const root = find(index);
    const existing = merged.get(root);
    if (existing) {
      existing.segments.push(...road.segments);
      existing.roadGroupId = [existing.roadGroupId, road.roadGroupId].sort()[0];
      existing.sourceIndex = Math.min(existing.sourceIndex, road.sourceIndex);
    } else merged.set(root, { ...road, segments: [...road.segments] });
  }
  return [...merged.values()];
}

export function coverageRoadForSegment<T extends CoverageSearchableSegment>(
  segments: T[],
  segmentId: string | null,
): CoverageRoad<T> | null {
  return segmentId
    ? (coverageRoads(segments).find((road) => road.segments.some(({ id }) => id === segmentId)) ??
        null)
    : null;
}

export function searchCoverageRoads<T extends CoverageSearchableSegment>(
  segments: T[],
  query: string,
): { matches: CoverageRoad<T>[]; total: number; hasMore: boolean } {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return { matches: [], total: 0, hasMore: false };
  const matches = coverageRoads(segments)
    .filter(({ streetName }) => streetName.toLocaleLowerCase().includes(normalizedQuery))
    .sort((first, second) =>
      first.streetName.localeCompare(second.streetName, undefined, { sensitivity: 'base' }),
    );
  return {
    matches: matches.slice(0, 20),
    total: matches.length,
    hasMore: matches.length > 20,
  };
}

export function coverageSearchAnnouncement(
  query: string,
  result: Pick<ReturnType<typeof searchCoverageRoads>, 'total' | 'hasMore'>,
): string | null {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return null;
  if (result.total === 0) return `No streets match “${normalizedQuery}”.`;
  return result.hasMore
    ? `Showing 20 of ${result.total} roads. Refine your search to narrow the list.`
    : `${result.total} matching ${result.total === 1 ? 'road' : 'roads'}.`;
}

export function coverageRoadResultContent<T extends CoverageSearchableSegment>(
  road: CoverageRoad<T>,
) {
  const dates = new Set(road.segments.map(({ lastCoveredOn }) => lastCoveredOn));
  const eligibleSections = road.segments.filter(({ eligible }) => eligible).length;
  return {
    streetName: road.streetName,
    sections: road.segments.length,
    estimatedTracts: road.segments.reduce((total, segment) => total + segment.estimatedHomes, 0),
    lastOutreach: dates.size === 1 ? [...dates][0] : ('mixed' as const),
    eligibility:
      eligibleSections === road.segments.length
        ? 'Eligible'
        : eligibleSections === 0
          ? 'Excluded'
          : `${eligibleSections} of ${road.segments.length} sections eligible`,
  } as const;
}

export function coverageRoadPacketGroups(
  segments: Array<
    Pick<CoverageSegment, 'estimatedHomes' | 'lastCoveredOn' | 'roots'> & {
      coverageClass: CoverageClass;
    }
  >,
) {
  const groups = new Map<
    string,
    {
      packetId: string | null;
      lastCoveredOn: string | null;
      coverageClass: CoverageClass;
      sections: number;
      estimatedTracts: number;
    }
  >();
  for (const segment of segments) {
    const packetId = segment.lastCoveredOn
      ? (segment.roots.findLast(
          (root) => root.packetId !== null && root.effectiveCoveredOn === segment.lastCoveredOn,
        )?.packetId ?? null)
      : null;
    const key = packetId ? `packet:${packetId}` : `date:${segment.lastCoveredOn ?? 'never'}`;
    const group = groups.get(key);
    if (group) {
      group.sections += 1;
      group.estimatedTracts += segment.estimatedHomes;
    } else {
      groups.set(key, {
        packetId,
        lastCoveredOn: segment.lastCoveredOn,
        coverageClass: segment.coverageClass,
        sections: 1,
        estimatedTracts: segment.estimatedHomes,
      });
    }
  }
  return [...groups.values()].sort((first, second) => {
    if (first.lastCoveredOn === null) return -1;
    if (second.lastCoveredOn === null) return 1;
    return first.lastCoveredOn.localeCompare(second.lastCoveredOn);
  });
}
export function currentWorkState(activePackets: number): 'active' | 'ready' {
  return activePackets > 0 ? 'active' : 'ready';
}

export function retainCoverageSelection(
  selectedSegmentId: string | null,
  segments: Array<{ id: string }>,
): string | null {
  return selectedSegmentId && segments.some((segment) => segment.id === selectedSegmentId)
    ? selectedSegmentId
    : null;
}

export type CoverageSegment = CoverageSegmentInput & {
  lastCoveredOn: string | null;
  roots: CoverageRoot[];
};

export type CorrectionRequest = { eventId: string; coveredOn: string | null };

export function calendarDateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
    ? parts
    : null;
}

function utcDay(value: string): number {
  const parts = dateParts(value);
  if (!parts) throw new Error('Invalid coverage date');
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86_400_000;
}

export function validateCoverageDate(value: string, asOf: string): string {
  const day = utcDay(value);
  if (day > utcDay(asOf)) throw new Error('Invalid coverage date');
  return value;
}

export function parseCorrectionRequest(value: unknown, asOf: string): CorrectionRequest {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'eventId') ||
    !Object.hasOwn(value, 'coveredOn')
  ) {
    throw new Error('Invalid correction request');
  }
  const { eventId, coveredOn } = value as Record<string, unknown>;
  if (
    typeof eventId !== 'string' ||
    eventId.length === 0 ||
    (coveredOn !== null && typeof coveredOn !== 'string')
  ) {
    throw new Error('Invalid correction request');
  }
  if (coveredOn !== null) {
    try {
      validateCoverageDate(coveredOn, asOf);
    } catch {
      throw new Error('Invalid correction request');
    }
  }
  return { eventId, coveredOn };
}

export function parseCoverageThresholds(value: unknown): CoverageThresholds {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    !Object.hasOwn(value, 'yellowAfterDays') ||
    !Object.hasOwn(value, 'orangeAfterDays') ||
    !Object.hasOwn(value, 'redAfterDays')
  ) {
    throw new Error('Invalid heatmap ranges');
  }
  const { yellowAfterDays, orangeAfterDays, redAfterDays } = value as Record<string, unknown>;
  if (
    !Number.isInteger(yellowAfterDays) ||
    !Number.isInteger(orangeAfterDays) ||
    !Number.isInteger(redAfterDays) ||
    (yellowAfterDays as number) < 1 ||
    (redAfterDays as number) > 3650 ||
    (yellowAfterDays as number) >= (orangeAfterDays as number) ||
    (orangeAfterDays as number) >= (redAfterDays as number)
  ) {
    throw new Error('Invalid heatmap ranges');
  }
  return {
    yellowAfterDays: yellowAfterDays as number,
    orangeAfterDays: orangeAfterDays as number,
    redAfterDays: redAfterDays as number,
  };
}

export function classifyCoverage(
  coveredOn: string | null,
  asOf: string,
  thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS,
): CoverageClass {
  if (!coveredOn) return 'red';
  const age = utcDay(asOf) - utcDay(coveredOn);
  if (age < thresholds.yellowAfterDays) return 'green';
  if (age < thresholds.orangeAfterDays) return 'yellow';
  if (age < thresholds.redAfterDays) return 'orange';
  return 'red';
}

export function coverageLegend(thresholds: CoverageThresholds): CoverageLegendItem[] {
  return [
    {
      coverageClass: 'green',
      label: `0-${thresholds.yellowAfterDays - 1} days`,
    },
    {
      coverageClass: 'yellow',
      label: `${thresholds.yellowAfterDays}-${thresholds.orangeAfterDays - 1} days`,
    },
    {
      coverageClass: 'orange',
      label: `${thresholds.orangeAfterDays}-${thresholds.redAfterDays - 1} days`,
    },
    {
      coverageClass: 'red',
      label: `${thresholds.redAfterDays}+ days or never`,
    },
    { coverageClass: 'gray', label: 'Excluded' },
  ];
}

export function countEligibleHomesByCoverageClass(
  segments: Array<
    Pick<CoverageSegmentInput, 'eligible' | 'estimatedHomes'> & {
      coverageClass: CoverageClass;
    }
  >,
): Record<CoverageClass, number> {
  const totals: Record<CoverageClass, number> = { green: 0, yellow: 0, orange: 0, red: 0 };
  for (const segment of segments) {
    if (segment.eligible) totals[segment.coverageClass] += segment.estimatedHomes;
  }
  return totals;
}

export function stackCoverageLabelRows(
  labels: Array<{ positionPercent: number; gapPercent: number }>,
): number[] {
  const rows: Array<typeof labels> = [];
  return labels.map((label) => {
    const openRow = rows.findIndex((row) =>
      row.every(
        (other) =>
          Math.abs(label.positionPercent - other.positionPercent) >=
          Math.max(label.gapPercent, other.gapPercent),
      ),
    );
    const rowIndex = openRow === -1 ? rows.length : openRow;
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex].push(label);
    return rowIndex;
  });
}

export function countEligibleHomesCovered(
  segments: CoverageSegment[],
  asOf: string,
  periodDays: number,
): number {
  if (!Number.isInteger(periodDays) || periodDays < 1) throw new Error('Invalid coverage period');
  const asOfDay = utcDay(asOf);
  const firstDay = asOfDay - (periodDays - 1);
  return segments.reduce(
    (total, segment) =>
      total +
      (segment.eligible &&
      segment.lastCoveredOn &&
      utcDay(segment.lastCoveredOn) >= firstDay &&
      utcDay(segment.lastCoveredOn) <= asOfDay
        ? segment.estimatedHomes
        : 0),
    0,
  );
}
