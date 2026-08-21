import type { ImportQuality } from './overture-import.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import { type Position, territoryBoundary } from './territory-geometry.ts';

export const OVERTURE_RELEASE = '2026-06-17.0';
const FOOTPRINT_EPSILON = 1e-9;

export type TerritoryImportMetadata = {
  kind: 'proof' | 'overture';
  release: string | null;
  center: Position | null;
  radiusMiles: number | null;
  completedAt: string | null;
  normalizerVersion: number | null;
  quality: ImportQuality | null;
};

export type ImportBounds = { west: number; south: number; east: number; north: number };
export type TerritoryImportPlan =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'incremental'; bounds: ImportBounds[] };

function importBounds(center: Position, radiusMiles: number): ImportBounds {
  const ring = territoryBoundary(center, radiusMiles, 'square').coordinates[0];
  return {
    west: ring[0][0],
    south: ring[0][1],
    east: ring[2][0],
    north: ring[2][1],
  };
}

export function planTerritoryImport(
  imported: TerritoryImportMetadata,
  draft: TerritoryDraftInput,
): TerritoryImportPlan {
  if (
    imported.kind === 'proof' ||
    imported.release !== OVERTURE_RELEASE ||
    imported.normalizerVersion !== 10 ||
    imported.quality == null ||
    imported.center === null ||
    imported.radiusMiles === null
  ) {
    return { kind: 'full' };
  }
  const oldBox = importBounds(imported.center, imported.radiusMiles);
  const newBox = importBounds(draft.center, draft.radiusMiles);
  const west = Math.max(oldBox.west, newBox.west);
  const south = Math.max(oldBox.south, newBox.south);
  const east = Math.min(oldBox.east, newBox.east);
  const north = Math.min(oldBox.north, newBox.north);
  if (west >= east - FOOTPRINT_EPSILON || south >= north - FOOTPRINT_EPSILON) {
    return { kind: 'full' };
  }
  const bounds = [
    { west: newBox.west, south: newBox.south, east: west, north: newBox.north },
    { west: east, south: newBox.south, east: newBox.east, north: newBox.north },
    { west, south: newBox.south, east, north: south },
    { west, south: north, east, north: newBox.north },
  ].filter(
    (box) => box.east - box.west > FOOTPRINT_EPSILON && box.north - box.south > FOOTPRINT_EPSILON,
  );
  return bounds.length === 0 ? { kind: 'none' } : { kind: 'incremental', bounds };
}

export function needsTerritoryImport(
  imported: TerritoryImportMetadata,
  draft: TerritoryDraftInput,
): boolean {
  return planTerritoryImport(imported, draft).kind !== 'none';
}
