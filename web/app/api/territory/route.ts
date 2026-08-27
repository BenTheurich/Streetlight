import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { applyMvpCapabilities } from '../../../lib/product-capabilities.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from '../../../lib/territory-draft.ts';
import { territoryImportLifecycle } from '../../../lib/territory-import-job.ts';
import { getTerritoryWorkspace } from '../../../lib/territory-persistence.ts';

export const dynamic = 'force-dynamic';

export function getTerritory() {
  return Response.json(applyMvpCapabilities(getTerritoryWorkspace()));
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

  try {
    const result = territoryImportLifecycle.save(draft);
    if (result.kind === 'importing') {
      return Response.json({ job: result.job }, { status: 202 });
    }
    if (result.kind === 'conflict') {
      return Response.json({ error: result.error }, { status: 409 });
    }
    return Response.json(applyMvpCapabilities(result.workspace));
  } catch {
    return Response.json(
      { error: 'Could not save region changes. No saved changes were replaced.' },
      { status: 500 },
    );
  }
}

export const GET = authenticatedRoute(getTerritory, undefined, undefined, true);
export const PATCH = authenticatedRoute(updateTerritory, undefined, undefined, true);
