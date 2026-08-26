import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { applyMvpCapabilities } from '../../../../lib/product-capabilities.ts';
import { territoryImportLifecycle } from '../../../../lib/territory-import-job.ts';

export const dynamic = 'force-dynamic';

export function getTerritoryImport() {
  const { job, workspace } = territoryImportLifecycle.observe();
  return Response.json({
    job,
    workspace: workspace ? applyMvpCapabilities(workspace) : null,
  });
}

export const GET = authenticatedRoute(getTerritoryImport, undefined, undefined, true);
