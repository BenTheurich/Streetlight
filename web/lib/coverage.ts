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

export type CoverageEvent = {
  id: string;
  segmentId: string;
  packetId?: string | null;
  sequence: number;
  coveredOn: string;
  kind: 'completed' | 'correction';
  correctsEventId: string | null;
  isVoid: boolean;
};

export type CoverageCorrection = Pick<CoverageEvent, 'id' | 'sequence' | 'coveredOn' | 'isVoid'>;

export type CoverageRoot = {
  eventId: string;
  packetId: string | null;
  originalCoveredOn: string;
  effectiveCoveredOn: string | null;
  corrections: CoverageCorrection[];
};

export type CoverageSegmentInput = {
  id: string;
  estimatedHomes: number;
  eligible: boolean;
};

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

export function deriveCoverageSegments(
  events: CoverageEvent[],
  asOf: string,
  inputs: CoverageSegmentInput[] = [],
): CoverageSegment[] {
  const segments = new Map<string, CoverageSegment>(
    inputs.map((input) => [input.id, { ...input, lastCoveredOn: null, roots: [] }]),
  );
  const roots = new Map<string, CoverageRoot>();
  for (const event of [...events].sort((first, second) => first.sequence - second.sequence)) {
    validateCoverageDate(event.coveredOn, asOf);
    if (!segments.has(event.segmentId)) {
      segments.set(event.segmentId, {
        id: event.segmentId,
        estimatedHomes: 0,
        eligible: false,
        lastCoveredOn: null,
        roots: [],
      });
    }
    const segment = segments.get(event.segmentId) as CoverageSegment;
    if (event.kind === 'completed') {
      const root: CoverageRoot = {
        eventId: event.id,
        packetId: event.packetId ?? null,
        originalCoveredOn: event.coveredOn,
        effectiveCoveredOn: event.coveredOn,
        corrections: [],
      };
      roots.set(event.id, root);
      segment.roots.push(root);
      continue;
    }
    const root = event.correctsEventId ? roots.get(event.correctsEventId) : undefined;
    if (!root) throw new Error('Invalid correction root');
    root.corrections.push({
      id: event.id,
      sequence: event.sequence,
      coveredOn: event.coveredOn,
      isVoid: event.isVoid,
    });
    root.effectiveCoveredOn = event.isVoid ? null : event.coveredOn;
  }
  for (const segment of segments.values()) {
    segment.lastCoveredOn = segment.roots.reduce<string | null>(
      (latest, root) =>
        !root.effectiveCoveredOn || (latest && latest >= root.effectiveCoveredOn)
          ? latest
          : root.effectiveCoveredOn,
      null,
    );
  }
  return [...segments.values()];
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
