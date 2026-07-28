import type { ExclusionArea, TerritorySegment, TerritoryWorkspace } from './database.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import {
  lineInsideTerritoryBoundary,
  lineIntersectsPolygon,
  type Position,
} from './territory-geometry.ts';

const VERTEX_KEY_STEP = 0.00005;

export function hasUnsavedTerritoryChanges(
  saved: TerritoryDraftInput,
  draft: TerritoryDraftInput,
  drawingPoints: Position[],
): boolean {
  return drawingPoints.length > 0 || JSON.stringify(draft) !== JSON.stringify(saved);
}

export function setSegmentExcluded(
  draft: TerritoryDraftInput,
  segmentId: string,
  excluded: boolean,
): TerritoryDraftInput {
  const ids = new Set(draft.excludedSegmentIds);
  if (excluded) {
    ids.add(segmentId);
  } else {
    ids.delete(segmentId);
  }
  return { ...draft, excludedSegmentIds: [...ids].sort() };
}

export function moveVertexWithArrowKey(points: Position[], index: number, key: string): Position[] {
  const delta: Position | undefined = {
    ArrowDown: [0, -VERTEX_KEY_STEP],
    ArrowLeft: [-VERTEX_KEY_STEP, 0],
    ArrowRight: [VERTEX_KEY_STEP, 0],
    ArrowUp: [0, VERTEX_KEY_STEP],
  }[key] as Position | undefined;
  if (!delta || !points[index]) {
    return points;
  }
  return points.map((point, pointIndex) =>
    pointIndex === index
      ? [
          Math.min(180, Math.max(-180, point[0] + delta[0])),
          Math.min(90, Math.max(-90, point[1] + delta[1])),
        ]
      : point,
  );
}

export function territoryDraftFromWorkspace(workspace: TerritoryWorkspace): TerritoryDraftInput {
  return {
    originAddress: workspace.originAddress,
    center: [...workspace.center],
    radiusMiles: workspace.radiusMiles,
    boundaryShape: workspace.boundaryShape,
    activatedRoadGroupIds: [
      ...new Set(
        workspace.segments
          .filter((segment) => segment.activationKind === 'manual')
          .map((segment) => segment.roadGroupId),
      ),
    ].sort(),
    excludedSegmentIds: workspace.segments
      .filter((segment) => segment.manuallyExcluded)
      .map((segment) => segment.id)
      .sort(),
    exclusions: structuredClone(workspace.exclusions),
  };
}

export function deriveTerritory(
  importedSegments: TerritorySegment[],
  draft: TerritoryDraftInput,
): Pick<TerritoryWorkspace, 'segments' | 'totals'> {
  const activatedRoadGroupIds = new Set(draft.activatedRoadGroupIds);
  const excludedSegmentIds = new Set(draft.excludedSegmentIds ?? []);
  const segments = importedSegments.map((segment): TerritorySegment => {
    const withinBoundary = lineInsideTerritoryBoundary(
      segment.geometry,
      draft.center,
      draft.radiusMiles,
      draft.boundaryShape,
    );
    const excluded = draft.exclusions.some(
      (area) => area.enabled && lineIntersectsPolygon(segment.geometry, area.geometry),
    );
    const manuallyActivated = activatedRoadGroupIds.has(segment.roadGroupId);
    const active = segment.active || manuallyActivated;
    const manuallyExcluded = excludedSegmentIds.has(segment.id);
    return {
      ...segment,
      activationKind: manuallyActivated ? 'manual' : segment.activationKind,
      active,
      withinBoundary,
      manuallyExcluded,
      eligible: active && withinBoundary && !excluded && !manuallyExcluded,
      excludedReason: !withinBoundary
        ? 'boundary'
        : !active
          ? 'hidden'
          : excluded
            ? 'exclusion'
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

export function affectedByExclusion(
  segments: TerritorySegment[],
  exclusion: ExclusionArea,
): { segments: number; homes: number } {
  const affected = segments.filter(
    (segment) =>
      segment.active &&
      segment.withinBoundary &&
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
