import type { CoverageRoot, CoverageWorkspace } from './coverage.ts';
import type { LineString, Position } from './territory-geometry.ts';

type ProgressEvent = { date: string; packetId: string | null };

export type OutreachProgressMode = 'calendar' | 'rolling';

export type OutreachProgressUnit = {
  id: string;
  kind: 'street' | 'apartment';
  streetKey: string | null;
  completedOn: string;
  estimatedHomes: number;
  geometry: LineString | { type: 'Point'; coordinates: Position };
};

export type OutreachProgressPeriod = {
  mode: OutreachProgressMode;
  year: number;
  startDate: string;
  endDate: string;
  dates: string[];
  events: ProgressEvent[];
  units: OutreachProgressUnit[];
};

export type OutreachProgressSnapshot = {
  completedPackets: number;
  streets: number;
  apartmentComplexes: number;
  estimatedHomes: number;
  outreachDays: number;
};

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const playbackBarShare = 0.2;
const playbackRevealShare = 0.6;

function dateValue(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function shiftDate(date: string, days: number): string {
  return new Date(dateValue(date) + days * millisecondsPerDay).toISOString().slice(0, 10);
}

export function outreachProgressPlayback(
  progress: OutreachProgressPeriod,
  position: number,
): {
  barPosition: number;
  completedStep: number;
  revealDate: string | null;
  revealProgress: number;
  selectedDate: string | null;
  through: string | null;
} {
  const endStep = progress.dates.length;
  const clamped = Math.max(0, Math.min(position, endStep));
  const baseStep = Math.floor(clamped);
  const phase = baseStep < endStep ? clamped - baseStep : 0;
  const targetDate = progress.dates[baseStep] ?? null;
  const barPhase = Math.min(phase / playbackBarShare, 1);
  const easedBarPhase = barPhase * barPhase * (3 - 2 * barPhase);
  const revealProgress = Math.max(0, Math.min((phase - playbackBarShare) / playbackRevealShare, 1));
  const completedStep = Math.min(
    endStep,
    baseStep + (targetDate !== null && revealProgress >= 1 ? 1 : 0),
  );
  const through = progress.dates[completedStep - 1] ?? null;
  return {
    barPosition: Math.min(endStep, baseStep + easedBarPhase),
    completedStep,
    revealDate: targetDate,
    revealProgress,
    selectedDate: phase >= playbackBarShare ? targetDate : (progress.dates[baseStep - 1] ?? null),
    through,
  };
}

function periodEvents(roots: CoverageRoot[], startDate: string, endDate: string): ProgressEvent[] {
  return roots.flatMap(({ effectiveCoveredOn, packetId }) =>
    effectiveCoveredOn && effectiveCoveredOn >= startDate && effectiveCoveredOn <= endDate
      ? [{ date: effectiveCoveredOn, packetId }]
      : [],
  );
}

export function outreachProgressYears(workspace: CoverageWorkspace): number[] {
  const years = new Set<number>([Number(workspace.asOf.slice(0, 4))]);
  for (const roots of [
    ...workspace.segments.map(({ roots }) => roots),
    ...workspace.apartmentComplexes.map(({ roots }) => roots),
  ]) {
    for (const { effectiveCoveredOn } of roots) {
      if (effectiveCoveredOn) years.add(Number(effectiveCoveredOn.slice(0, 4)));
    }
  }
  return [...years].sort((first, second) => second - first);
}

export function buildOutreachProgress(
  workspace: CoverageWorkspace,
  selection: number | 'rolling',
): OutreachProgressPeriod {
  const mode: OutreachProgressMode = selection === 'rolling' ? 'rolling' : 'calendar';
  const year = selection === 'rolling' ? Number(workspace.asOf.slice(0, 4)) : selection;
  const startDate = mode === 'rolling' ? shiftDate(workspace.asOf, -363) : `${year}-01-01`;
  const endDate =
    mode === 'rolling'
      ? workspace.asOf
      : year === Number(workspace.asOf.slice(0, 4))
        ? workspace.asOf
        : `${year}-12-31`;
  const events: ProgressEvent[] = [];
  const units: OutreachProgressUnit[] = [];
  for (const segment of workspace.segments) {
    const matches = periodEvents(segment.roots, startDate, endDate);
    if (matches.length === 0) continue;
    events.push(...matches);
    units.push({
      id: segment.id,
      kind: 'street',
      streetKey: segment.streetName.trim().toLowerCase() || segment.roadGroupId,
      completedOn: matches.map(({ date }) => date).sort()[0],
      estimatedHomes: segment.estimatedHomes,
      geometry: segment.geometry,
    });
  }
  for (const apartment of workspace.apartmentComplexes) {
    const matches = periodEvents(apartment.roots, startDate, endDate);
    if (matches.length === 0) continue;
    events.push(...matches);
    units.push({
      id: apartment.id,
      kind: 'apartment',
      streetKey: null,
      completedOn: matches.map(({ date }) => date).sort()[0],
      estimatedHomes: apartment.estimatedTracts,
      geometry: { type: 'Point', coordinates: apartment.position },
    });
  }
  return {
    mode,
    year,
    startDate,
    endDate,
    dates: [...new Set(events.map(({ date }) => date))].sort(),
    events: events.sort((first, second) => first.date.localeCompare(second.date)),
    units: units.sort(
      (first, second) =>
        first.completedOn.localeCompare(second.completedOn) || first.id.localeCompare(second.id),
    ),
  };
}

export function outreachProgressSnapshot(
  progress: OutreachProgressPeriod,
  through: string | null,
): OutreachProgressSnapshot {
  const units = through ? progress.units.filter(({ completedOn }) => completedOn <= through) : [];
  const events = through ? progress.events.filter(({ date }) => date <= through) : [];
  return {
    completedPackets: new Set(events.flatMap(({ packetId }) => (packetId ? [packetId] : []))).size,
    streets: new Set(
      units.flatMap(({ kind, streetKey }) => (kind === 'street' && streetKey ? [streetKey] : [])),
    ).size,
    apartmentComplexes: units.filter(({ kind }) => kind === 'apartment').length,
    estimatedHomes: units.reduce((total, unit) => total + unit.estimatedHomes, 0),
    outreachDays: new Set(events.map(({ date }) => date)).size,
  };
}
