import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { getTerritoryWorkspace, saveTerritoryDraft } from '../../../lib/database.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from '../../../lib/territory-draft.ts';
import { needsTerritoryImport } from '../../../lib/territory-import.ts';
import {
  createOrReuseTerritoryImportJob,
  ensureTerritoryImportJobRunning,
  TerritoryImportConflictError,
} from '../../../lib/territory-import-job.ts';
import { requireWorkspaceScope } from '../../../lib/workspace-scope.ts';

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
      { error: error instanceof Error ? error.message : 'Invalid region draft' },
      { status: 400 },
    );
  }

  const workspace = getTerritoryWorkspace();
  if (needsTerritoryImport(workspace.import, draft)) {
    try {
      const job = createOrReuseTerritoryImportJob(draft);
      ensureTerritoryImportJobRunning(job, requireWorkspaceScope());
      return Response.json({ job }, { status: 202 });
    } catch (error) {
      if (error instanceof TerritoryImportConflictError) {
        return Response.json({ error: error.message }, { status: 409 });
      }
      return Response.json(
        { error: 'Could not start street data preparation. No saved changes were replaced.' },
        { status: 500 },
      );
    }
  }

  try {
    saveTerritoryDraft(draft);
    return Response.json(getTerritoryWorkspace());
  } catch {
    return Response.json({ error: 'Could not save region changes' }, { status: 500 });
  }
}

export const GET = authenticatedRoute(getTerritory, undefined, undefined, true);
export const PATCH = authenticatedRoute(updateTerritory, undefined, undefined, true);
