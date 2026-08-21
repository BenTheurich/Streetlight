import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import {
  getCurrentImportedTerritory,
  getTerritoryWorkspace,
  saveTerritoryDraft,
} from '../../../lib/database.ts';
import {
  type ImportedTerritoryInput,
  mergeImportedTerritories,
  runOvertureImport,
} from '../../../lib/overture-import.ts';
import { parseTerritoryDraft, type TerritoryDraftInput } from '../../../lib/territory-draft.ts';
import { type ImportBounds, planTerritoryImport } from '../../../lib/territory-import.ts';

export const dynamic = 'force-dynamic';

export function getTerritory() {
  return Response.json(getTerritoryWorkspace());
}

type TerritoryRouteDependencies = {
  filename?: string;
  runImport?: (
    center: [number, number],
    radiusMiles: number,
    bounds?: ImportBounds,
  ) => Promise<ImportedTerritoryInput>;
};

export async function updateTerritory(
  request: Request,
  dependencies: TerritoryRouteDependencies = {},
) {
  let draft: TerritoryDraftInput;
  try {
    draft = parseTerritoryDraft(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid territory draft' },
      { status: 400 },
    );
  }

  const workspace = getTerritoryWorkspace(dependencies.filename);
  let imported: ImportedTerritoryInput | undefined;
  const plan = planTerritoryImport(workspace.import, draft);
  if (plan.kind !== 'none') {
    try {
      const runImport = dependencies.runImport ?? runOvertureImport;
      if (plan.kind === 'full') {
        imported = await runImport(draft.center, draft.radiusMiles);
      } else {
        const current = getCurrentImportedTerritory(dependencies.filename);
        if (!current) {
          imported = await runImport(draft.center, draft.radiusMiles);
        } else {
          const additions: ImportedTerritoryInput[] = [];
          for (const bounds of plan.bounds) {
            additions.push(await runImport(draft.center, draft.radiusMiles, bounds));
          }
          imported = mergeImportedTerritories(current, additions, draft.center, draft.radiusMiles);
        }
      }
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
    saveTerritoryDraft(draft, { filename: dependencies.filename, imported });
    return Response.json(getTerritoryWorkspace(dependencies.filename));
  } catch {
    return Response.json({ error: 'Could not save territory changes' }, { status: 500 });
  }
}

export const GET = authenticatedRoute(getTerritory, undefined, undefined, true);
export const PATCH = authenticatedRoute(updateTerritory, undefined, undefined, true);
