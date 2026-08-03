import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { getTerritoryWorkspace } from '../../../../lib/database.ts';
import {
  ensureTerritoryImportJobRunning,
  getLatestTerritoryImportJob,
  getTerritoryImportJob,
} from '../../../../lib/territory-import-job.ts';
import { requireWorkspaceScope } from '../../../../lib/workspace-scope.ts';

export const dynamic = 'force-dynamic';

export function getTerritoryImport() {
  let job = getLatestTerritoryImportJob();
  if (job) {
    ensureTerritoryImportJobRunning(job, requireWorkspaceScope());
    job = getTerritoryImportJob(job.id);
  }
  return Response.json({
    job,
    workspace: job?.status === 'succeeded' ? getTerritoryWorkspace() : null,
  });
}

export const GET = authenticatedRoute(getTerritoryImport, undefined, undefined, true);
