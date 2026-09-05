import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import type { ReconciliationSelection } from '../../../lib/reconciliation.ts';
import {
  applyReconciliation,
  ReconciliationApplyError,
  type ReconciliationApplyResult,
  readReconciliation,
} from '../../../lib/reconciliation-persistence.ts';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function getReconciliation(request?: Request): Response {
  const query = request ? new URL(request.url).searchParams : new URLSearchParams();
  if (
    [...query.keys()].some(
      (key) => !['view', 'batchId', 'packetId'].includes(key) || query.getAll(key).length !== 1,
    ) ||
    (query.has('view') && !['active', 'history'].includes(query.get('view') ?? '')) ||
    ['batchId', 'packetId'].some((key) => query.has(key) && !query.get(key)?.trim()) ||
    (query.has('batchId') && query.has('packetId'))
  ) {
    return json({ error: 'Invalid reconciliation selection' }, 400);
  }
  const selection: ReconciliationSelection = {
    view: (query.get('view') ?? undefined) as ReconciliationSelection['view'],
    batchId: query.get('batchId') ?? undefined,
    packetId: query.get('packetId') ?? undefined,
  };
  try {
    return json(readReconciliation({ selection }));
  } catch (error) {
    if (error instanceof ReconciliationApplyError) return json({ error: error.message }, 404);
    return json({ error: 'Could not load packet reconciliation' }, 500);
  }
}

function mutationResponse(result: ReconciliationApplyResult): Response {
  if (result.kind === 'accepted') return json(result.workspace);
  if (result.kind === 'invalid') return json({ error: result.message }, 400);
  if (result.kind === 'not-found') return json({ error: result.message }, 404);
  return json({ error: result.message }, 409);
}

async function requestPayload(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function reconcilePackets(request: Request): Promise<Response> {
  try {
    return mutationResponse(applyReconciliation('reconcile', await requestPayload(request)));
  } catch {
    return json({ error: 'Could not reconcile packet batch' }, 500);
  }
}

export async function correctPacket(request: Request): Promise<Response> {
  try {
    return mutationResponse(applyReconciliation('completion', await requestPayload(request)));
  } catch {
    return json({ error: 'Could not change packet completion' }, 500);
  }
}

export const GET = authenticatedRoute(getReconciliation);
export const POST = authenticatedRoute(reconcilePackets);
export const PATCH = authenticatedRoute(correctPacket);
