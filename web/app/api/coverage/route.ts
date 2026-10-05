import { withAccountActivity } from '../../../lib/account-activity.ts';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { parseCorrectionRequest, parseCoverageThresholds } from '../../../lib/coverage.ts';
import {
  appendCoverageCorrection,
  getCoverageWorkspace,
  saveCoverageThresholds,
} from '../../../lib/coverage-persistence.ts';
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

  const targetId =
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'eventId' in body &&
    typeof body.eventId === 'string'
      ? body.eventId
      : null;
  let workspace: ReturnType<typeof getCoverageWorkspace>;
  try {
    workspace = applyMvpCapabilities(getCoverageWorkspace());
  } catch {
    return withAccountActivity(json({ error: 'Invalid correction request' }, 400), {
      targetId,
      outcome: 'failed',
    });
  }

  let correction: ReturnType<typeof parseCorrectionRequest>;
  try {
    correction = parseCorrectionRequest(body, workspace.asOf);
  } catch {
    return withAccountActivity(json({ error: 'Invalid correction request' }, 400), {
      targetId,
      outcome: 'rejected',
    });
  }

  try {
    return withAccountActivity(
      json(
        applyMvpCapabilities(appendCoverageCorrection(correction.eventId, correction.coveredOn)),
      ),
      { targetId: correction.eventId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const rejected = [
      'Coverage event not found',
      'Packet-managed coverage must be corrected in Reconcile packets',
      'Coverage event is already void',
    ].includes(message);
    return withAccountActivity(
      message === 'Coverage event not found'
        ? json({ error: message }, 404)
        : json({ error: 'Invalid correction request' }, 400),
      { targetId: correction.eventId, outcome: rejected ? 'rejected' : 'failed' },
    );
  }
}

export async function updateCoverageRanges(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }

  let thresholds: ReturnType<typeof parseCoverageThresholds>;
  try {
    thresholds = parseCoverageThresholds(body);
  } catch {
    return json({ error: 'Invalid heatmap ranges' }, 400);
  }
  try {
    return json(applyMvpCapabilities(saveCoverageThresholds(thresholds)));
  } catch {
    return withAccountActivity(json({ error: 'Invalid heatmap ranges' }, 400), {
      outcome: 'failed',
    });
  }
}

export const GET = authenticatedRoute(getCoverage);
export const POST = authenticatedRoute(
  correctCoverage,
  undefined,
  undefined,
  false,
  'coverage_correction',
);
export const PATCH = authenticatedRoute(
  updateCoverageRanges,
  undefined,
  undefined,
  false,
  'coverage_settings',
);
