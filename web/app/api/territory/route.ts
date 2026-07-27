import { getTerritoryWorkspace, saveTerritoryDraft } from '@/lib/database';
import { runOvertureImport } from '@/lib/overture-import';
import { parseTerritoryDraft, type TerritoryDraftInput } from '@/lib/territory-draft';
import { needsTerritoryImport } from '@/lib/territory-import';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getTerritoryWorkspace());
}

export async function PATCH(request: Request) {
  let draft: TerritoryDraftInput;
  try {
    draft = parseTerritoryDraft(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid territory draft' },
      { status: 400 },
    );
  }

  try {
    const workspace = getTerritoryWorkspace();
    const imported = needsTerritoryImport(workspace.import, draft)
      ? await runOvertureImport(draft.center, draft.radiusMiles)
      : undefined;
    saveTerritoryDraft(draft, { imported });
    return Response.json(getTerritoryWorkspace());
  } catch {
    return Response.json({ error: 'Could not save territory changes' }, { status: 500 });
  }
}
