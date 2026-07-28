import type { ImportQuality } from './overture-import.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import type { Position } from './territory-geometry.ts';

export const OVERTURE_RELEASE = '2026-06-17.0';

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
  return (
    imported.kind === 'proof' ||
    imported.release !== OVERTURE_RELEASE ||
    imported.normalizerVersion !== 4 ||
    imported.quality == null ||
    imported.center === null ||
    imported.radiusMiles === null ||
    imported.center[0] !== draft.center[0] ||
    imported.center[1] !== draft.center[1] ||
    draft.radiusMiles > imported.radiusMiles + 1e-9
  );
}
