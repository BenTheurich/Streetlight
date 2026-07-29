import { authenticatedRoute } from '@/lib/authenticated-route';
import { getTerritoryWorkspace, saveTerritoryDraft } from '@/lib/database';
import { type ImportedTerritoryInput, runOvertureImport } from '@/lib/overture-import';
import { parseTerritoryDraft, type TerritoryDraftInput } from '@/lib/territory-draft';
import { needsTerritoryImport } from '@/lib/territory-import';

export const dynamic = 'force-dynamic';

export function getTerritory() {
  return Response.json(getTerritoryWorkspace());
}

export async function updateTerritory(request: Request) {
  let draft: TerritoryDraftInput;
  try {
    draft = parseTerritoryDraft(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid territory draft' },
      { status: 400 },
    );
  }

  const workspace = getTerritoryWorkspace();
  let imported: ImportedTerritoryInput | undefined;
  if (needsTerritoryImport(workspace.import, draft)) {
    try {
      imported = await runOvertureImport(draft.center, draft.radiusMiles);
    } catch {
      return Response.json(
        {
          error: 'Street data import failed. No saved changes were replaced.',
        },
        { status: 500 },
      );
    }
  }

  try {
    saveTerritoryDraft(draft, { imported });
    return Response.json(getTerritoryWorkspace());
  } catch {
    return Response.json({ error: 'Could not save territory changes' }, { status: 500 });
  }
}

export const GET = authenticatedRoute(getTerritory, undefined, undefined, true);
export const PATCH = authenticatedRoute(updateTerritory, undefined, undefined, true);
