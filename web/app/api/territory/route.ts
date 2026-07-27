import { getTerritoryWorkspace, saveTerritoryDraft } from '@/lib/database';
import { parseTerritoryDraft, type TerritoryDraftInput } from '@/lib/territory-draft';

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
    saveTerritoryDraft(draft);
    return Response.json(getTerritoryWorkspace());
  } catch {
    return Response.json({ error: 'Could not save territory changes' }, { status: 500 });
  }
}
