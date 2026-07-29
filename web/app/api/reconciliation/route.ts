import {
  correctPacketCompletion,
  getReconciliationWorkspace,
  reconcilePacketBatch,
} from '../../../lib/database.ts';
import {
  parsePacketCompletionCorrection,
  parseReconciliationInput,
  ReconciliationConflictError,
} from '../../../lib/reconciliation.ts';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function GET(): Response {
  try {
    return json(getReconciliationWorkspace());
  } catch {
    return json({ error: 'Could not load packet reconciliation' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  let input;
  try {
    input = parseReconciliationInput(await request.json());
  } catch {
    return json({ error: 'Invalid reconciliation request' }, 400);
  }
  try {
    return json(reconcilePacketBatch(input));
  } catch (error) {
    if (error instanceof ReconciliationConflictError) {
      return json({ error: `${error.message}. Reload and review the batch again.` }, 409);
    }
    if (error instanceof Error && error.message === 'Batch not found') {
      return json({ error: error.message }, 404);
    }
    return json({ error: 'Could not reconcile packet batch' }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let input;
  try {
    const workspace = getReconciliationWorkspace();
    input = parsePacketCompletionCorrection(await request.json(), workspace.asOf);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid packet correction request') {
      return json({ error: error.message }, 400);
    }
    return json({ error: 'Could not change packet completion' }, 500);
  }
  try {
    return json(correctPacketCompletion(input));
  } catch (error) {
    if (error instanceof ReconciliationConflictError) {
      return json({ error: error.message }, 409);
    }
    if (
      error instanceof Error &&
      (error.message === 'Packet not found' || error.message === 'Packet completion not found')
    ) {
      return json({ error: error.message }, 404);
    }
    if (error instanceof Error && error.message === 'Packet is not completed') {
      return json({ error: error.message }, 409);
    }
    return json({ error: 'Could not change packet completion' }, 500);
  }
}
