import type { CoverageRoot, CoverageWorkspace } from './coverage.ts';
import type { LineString, Position } from './territory-geometry.ts';

type ProgressEvent = { date: string; packetId: string | null };

export type OutreachProgressUnit = {
  id: string;
  kind: 'street' | 'apartment';
  completedOn: string;
  estimatedHomes: number;
  geometry: LineString | { type: 'Point'; coordinates: Position };
};

export type OutreachProgressPeriod = {
  year: number;
  dates: string[];
  events: ProgressEvent[];
  units: OutreachProgressUnit[];
};

export type OutreachProgressSnapshot = {
  completedPackets: number;
  streetSections: number;
  apartmentComplexes: number;
  estimatedHomes: number;
  outreachDays: number;
};

function periodEvents(roots: CoverageRoot[], year: number): ProgressEvent[] {
  return roots.flatMap(({ effectiveCoveredOn, packetId }) =>
    effectiveCoveredOn?.startsWith(`${year}-`) ? [{ date: effectiveCoveredOn, packetId }] : [],
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
  year: number,
): OutreachProgressPeriod {
  const events: ProgressEvent[] = [];
  const units: OutreachProgressUnit[] = [];
  for (const segment of workspace.segments) {
    const matches = periodEvents(segment.roots, year);
    if (matches.length === 0) continue;
    events.push(...matches);
    units.push({
      id: segment.id,
      kind: 'street',
      completedOn: matches.map(({ date }) => date).sort()[0],
      estimatedHomes: segment.estimatedHomes,
      geometry: segment.geometry,
    });
  }
  for (const apartment of workspace.apartmentComplexes) {
    const matches = periodEvents(apartment.roots, year);
    if (matches.length === 0) continue;
    events.push(...matches);
    units.push({
      id: apartment.id,
      kind: 'apartment',
      completedOn: matches.map(({ date }) => date).sort()[0],
      estimatedHomes: apartment.estimatedTracts,
      geometry: { type: 'Point', coordinates: apartment.position },
    });
  }
  return {
    year,
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
    streetSections: units.filter(({ kind }) => kind === 'street').length,
    apartmentComplexes: units.filter(({ kind }) => kind === 'apartment').length,
    estimatedHomes: units.reduce((total, unit) => total + unit.estimatedHomes, 0),
    outreachDays: new Set(events.map(({ date }) => date)).size,
  };
}
