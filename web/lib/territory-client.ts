import type { ExclusionArea, TerritorySegment, TerritoryWorkspace } from './database.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import { lineInsideCircle, lineIntersectsPolygon } from './territory-geometry.ts';

export function territoryDraftFromWorkspace(workspace: TerritoryWorkspace): TerritoryDraftInput {
  return {
    originAddress: workspace.originAddress,
    center: [...workspace.center],
    radiusMiles: workspace.radiusMiles,
    exclusions: structuredClone(workspace.exclusions),
  };
}

export function deriveTerritory(
  importedSegments: TerritorySegment[],
  draft: TerritoryDraftInput,
): Pick<TerritoryWorkspace, 'segments' | 'totals'> {
  const segments = importedSegments.map((segment): TerritorySegment => {
    const outsideRadius = !lineInsideCircle(segment.geometry, draft.center, draft.radiusMiles);
    const excluded = draft.exclusions.some((area) =>
      lineIntersectsPolygon(segment.geometry, area.geometry),
    );
    return {
      ...segment,
      eligible: !outsideRadius && !excluded,
      excludedReason: outsideRadius ? 'radius' : excluded ? 'exclusion' : null,
    };
  });
  return {
    segments,
    totals: {
      allSegments: segments.length,
      eligibleSegments: segments.filter((segment) => segment.eligible).length,
      allHomes: segments.reduce((total, segment) => total + segment.estimatedHomes, 0),
      eligibleHomes: segments
        .filter((segment) => segment.eligible)
        .reduce((total, segment) => total + segment.estimatedHomes, 0),
    },
  };
}

export function affectedByExclusion(
  segments: TerritorySegment[],
  exclusion: ExclusionArea,
): { segments: number; homes: number } {
  const affected = segments.filter((segment) =>
    lineIntersectsPolygon(segment.geometry, exclusion.geometry),
  );
  return {
    segments: affected.length,
    homes: affected.reduce((total, segment) => total + segment.estimatedHomes, 0),
  };
}

export function nextExclusionName(exclusions: ExclusionArea[]): string {
  const names = new Set(exclusions.map((area) => area.name));
  let index = 1;
  while (names.has(`Excluded area ${index}`)) {
    index += 1;
  }
  return `Excluded area ${index}`;
}
