import type { TerritorySegment, TerritoryWorkspace } from './database.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import { lineInsideTerritoryBoundary, type Position } from './territory-geometry.ts';

export async function refreshTerritoryViews(
  imported: boolean,
  refreshCoverage: () => Promise<void>,
  refreshMapData: () => Promise<void>,
): Promise<void> {
  const refreshes = [refreshCoverage()];
  if (imported) refreshes.push(refreshMapData());
  await Promise.all(refreshes);
}

export function hasUnsavedTerritoryChanges(
  saved: TerritoryDraftInput,
  draft: TerritoryDraftInput,
  drawingPoints: Position[] = [],
): boolean {
  return drawingPoints.length > 0 || JSON.stringify(draft) !== JSON.stringify(saved);
}

export function setSegmentsExcluded(
  draft: TerritoryDraftInput,
  segmentIds: Iterable<string>,
  excluded: boolean,
): TerritoryDraftInput {
  const ids = new Set(draft.excludedSegmentIds);
  for (const segmentId of segmentIds) {
    if (excluded) ids.add(segmentId);
    else ids.delete(segmentId);
  }
  return { ...draft, excludedSegmentIds: [...ids].sort() };
}

export function setSegmentExcluded(
  draft: TerritoryDraftInput,
  segmentId: string,
  excluded: boolean,
): TerritoryDraftInput {
  return setSegmentsExcluded(draft, [segmentId], excluded);
}

export function activateSegments(
  draft: TerritoryDraftInput,
  segmentIds: Iterable<string>,
): TerritoryDraftInput {
  const ids = new Set(draft.activatedSegmentIds);
  for (const segmentId of segmentIds) ids.add(segmentId);
  return { ...draft, activatedSegmentIds: [...ids].sort() };
}

export function territoryDraftFromWorkspace(workspace: TerritoryWorkspace): TerritoryDraftInput {
  return {
    originAddress: workspace.originAddress,
    center: [...workspace.center],
    radiusMiles: workspace.radiusMiles,
    boundaryShape: workspace.boundaryShape,
    activatedSegmentIds: workspace.segments
      .filter((segment) => segment.activationKind === 'manual')
      .map((segment) => segment.id)
      .sort(),
    excludedSegmentIds: workspace.segments
      .filter((segment) => segment.manuallyExcluded)
      .map((segment) => segment.id)
      .sort(),
    apartmentStatuses: workspace.apartmentComplexes.map(({ id, reviewStatus }) => ({
      id,
      reviewStatus,
    })),
  };
}

export function deriveTerritory(
  importedSegments: TerritorySegment[],
  draft: TerritoryDraftInput,
): Pick<TerritoryWorkspace, 'segments' | 'totals'> {
  const activatedSegmentIds = new Set(draft.activatedSegmentIds);
  const excludedSegmentIds = new Set(draft.excludedSegmentIds);
  const segments = importedSegments.map((segment): TerritorySegment => {
    const withinBoundary = lineInsideTerritoryBoundary(
      segment.geometry,
      draft.center,
      draft.radiusMiles,
      draft.boundaryShape,
    );
    const manuallyActivated = activatedSegmentIds.has(segment.id);
    const active = segment.active || manuallyActivated;
    const manuallyExcluded = excludedSegmentIds.has(segment.id);
    return {
      ...segment,
      activationKind: manuallyActivated ? 'manual' : segment.activationKind,
      active,
      withinBoundary,
      manuallyExcluded,
      eligible: active && withinBoundary && !manuallyExcluded,
      excludedReason: !withinBoundary
        ? 'boundary'
        : !active
          ? 'hidden'
          : manuallyExcluded
            ? 'segment'
            : null,
    };
  });
  return {
    segments,
    totals: {
      allSegments: segments.filter((segment) => segment.active && segment.withinBoundary).length,
      eligibleSegments: segments.filter((segment) => segment.eligible).length,
      allHomes: segments
        .filter((segment) => segment.active && segment.withinBoundary)
        .reduce((total, segment) => total + segment.estimatedHomes, 0),
      eligibleHomes: segments
        .filter((segment) => segment.eligible)
        .reduce((total, segment) => total + segment.estimatedHomes, 0),
    },
  };
}
