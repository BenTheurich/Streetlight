import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { parseCorrectionRequest, parseCoverageThresholds } from '../../../lib/coverage.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  saveCoverageThresholds,
} from '../../../lib/database.ts';
import { applyMvpCapabilities } from '../../../lib/product-capabilities.ts';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function getCoverage(): Response {
  return json(applyMvpCapabilities(getCoverageWorkspace()));
}

export async function correctCoverage(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid correction request' }, 400);
  }

  try {
    const workspace = applyMvpCapabilities(getCoverageWorkspace());
    const correction = parseCorrectionRequest(body, workspace.asOf);
    appendCoverageCorrection(correction.eventId, correction.coveredOn);
    return json(applyMvpCapabilities(getCoverageWorkspace()));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Coverage event not found') {
      return json({ error: message }, 404);
    }
    return json({ error: 'Invalid correction request' }, 400);
  }
}

export async function updateCoverageRanges(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }

  try {
    saveCoverageThresholds(parseCoverageThresholds(body));
    return json(applyMvpCapabilities(getCoverageWorkspace()));
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }
}

export const GET = authenticatedRoute(getCoverage);
export const POST = authenticatedRoute(correctCoverage);
export const PATCH = authenticatedRoute(updateCoverageRanges);
