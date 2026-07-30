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

export function needsTerritoryImport(
  imported: TerritoryImportMetadata,
  draft: TerritoryDraftInput,
): boolean {
  if (
    imported.kind === 'proof' ||
    imported.release !== OVERTURE_RELEASE ||
    imported.normalizerVersion !== 10 ||
    imported.quality == null ||
    imported.center === null ||
    imported.radiusMiles === null
  ) {
    return true;
  }
  const [importWestSouth, importEastSouth, importEastNorth] = territoryBoundary(
    imported.center,
    imported.radiusMiles,
    'square',
  ).coordinates[0];
  const [draftWestSouth, draftEastSouth, draftEastNorth] = territoryBoundary(
    draft.center,
    draft.radiusMiles,
    'square',
  ).coordinates[0];
  return (
    draftWestSouth[0] < importWestSouth[0] - FOOTPRINT_EPSILON ||
    draftWestSouth[1] < importWestSouth[1] - FOOTPRINT_EPSILON ||
    draftEastSouth[0] > importEastSouth[0] + FOOTPRINT_EPSILON ||
    draftEastNorth[1] > importEastNorth[1] + FOOTPRINT_EPSILON
  );
}
