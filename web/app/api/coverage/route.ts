import { parseCorrectionRequest, parseCoverageThresholds } from '../../../lib/coverage.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  saveCoverageThresholds,
} from '../../../lib/database.ts';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function GET(): Response {
  return json(getCoverageWorkspace());
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid correction request' }, 400);
  }

  try {
    const workspace = getCoverageWorkspace();
    const correction = parseCorrectionRequest(body, workspace.asOf);
    appendCoverageCorrection(correction.eventId, correction.coveredOn);
    return json(getCoverageWorkspace());
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Coverage event not found') {
      return json({ error: message }, 404);
    }
    return json({ error: 'Invalid correction request' }, 400);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }

  try {
    saveCoverageThresholds(parseCoverageThresholds(body));
    return json(getCoverageWorkspace());
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }
}
