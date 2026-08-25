import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { applyMvpCapabilities } from '../../../../lib/product-capabilities.ts';
import {
  ensureTerritoryImportJobRunning,
  getLatestTerritoryImportJob,
  getTerritoryImportJob,
} from '../../../../lib/territory-import-job.ts';
import { getTerritoryWorkspace } from '../../../../lib/territory-persistence.ts';
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
    workspace: job?.status === 'succeeded' ? applyMvpCapabilities(getTerritoryWorkspace()) : null,
  });
}

export const GET = authenticatedRoute(getTerritoryImport, undefined, undefined, true);
