export type CoverageClass = 'red' | 'orange' | 'yellow' | 'green';

export type CoverageEvent = {
  id: string;
  segmentId: string;
  sequence: number;
  coveredOn: string;
  kind: 'completed' | 'correction';
  correctsEventId: string | null;
  isVoid: boolean;
};

export type CoverageCorrection = Pick<CoverageEvent, 'id' | 'sequence' | 'coveredOn' | 'isVoid'>;

export type CoverageRoot = {
  eventId: string;
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

export function classifyCoverage(coveredOn: string | null, asOf: string): CoverageClass {
  if (!coveredOn) return 'red';
  const age = utcDay(asOf) - utcDay(coveredOn);
  if (age <= 89) return 'green';
  if (age <= 179) return 'yellow';
  if (age <= 364) return 'orange';
  return 'red';
}

export function countEligibleHomesCovered(
  segments: CoverageSegment[],
  asOf: string,
  periodDays: number,
): number {
  if (!Number.isInteger(periodDays) || periodDays < 1) throw new Error('Invalid coverage period');
  const firstDay = utcDay(asOf) - (periodDays - 1);
  return segments.reduce(
    (total, segment) =>
      total +
      (segment.eligible && segment.lastCoveredOn && utcDay(segment.lastCoveredOn) >= firstDay
        ? segment.estimatedHomes
        : 0),
    0,
  );
}
