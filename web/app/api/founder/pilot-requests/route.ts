import type { AuthLoader } from '../../../../lib/auth.ts';
import { FounderAccessNotFoundError, requireFounderSession } from '../../../../lib/founder-auth.ts';
import {
  type FounderIdentityAdapter,
  readPilotInvitationStatuses,
} from '../../../../lib/founder-church-accounts.ts';
import { declinePilotRequest, listPilotRequests } from '../../../../lib/pilot-requests.ts';
import {
  provisionPilotRequest,
  type WorkOSProvisioningAdapter,
} from '../../../../lib/workos-provisioning.ts';

type FounderAction =
  | { action: 'decline'; id: string }
  | { action: 'approve'; id: string; churchName: string; email: string };

function parseAction(value: unknown): FounderAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid review action');
  }
  const input = value as Record<string, unknown>;
  if (input.action === 'decline') {
    if (
      Object.keys(input).sort().join(',') !== 'action,id' ||
      typeof input.id !== 'string' ||
      !input.id
    ) {
      throw new Error('Invalid review action');
    }
    return { action: 'decline', id: input.id };
  }
  if (
    input.action === 'approve' &&
    Object.keys(input).sort().join(',') === 'action,churchName,email,id' &&
    typeof input.id === 'string' &&
    typeof input.churchName === 'string' &&
    typeof input.email === 'string'
  ) {
    return {
      action: 'approve',
      id: input.id,
      churchName: input.churchName,
      email: input.email,
    };
  }
  throw new Error('Invalid review action');
}

export async function handleFounderPilotRequests(
  request: Request,
  loadSession?: AuthLoader,
  adapter?: WorkOSProvisioningAdapter,
  filename?: string,
  founderEmail?: string,
  identityAdapter?: FounderIdentityAdapter,
): Promise<Response> {
  try {
    await requireFounderSession(loadSession, founderEmail);
  } catch (error) {
    if (error instanceof FounderAccessNotFoundError) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    throw error;
  }

  if (request.method === 'GET') {
    const requests = listPilotRequests(filename);
    return Response.json(
      {
        requests,
        invitationStatuses: await readPilotInvitationStatuses(requests, identityAdapter),
        checkedAt: new Date().toISOString(),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const action = parseAction(await request.json());
    const reviewed =
      action.action === 'decline'
        ? declinePilotRequest(action.id, filename)
        : await provisionPilotRequest(
            action.id,
            { churchName: action.churchName, email: action.email },
            adapter,
            filename,
          );
    const invitations =
      action.action === 'approve'
        ? await readPilotInvitationStatuses([reviewed], identityAdapter)
        : {};
    return Response.json({ request: reviewed, invitation: invitations[reviewed.id] ?? null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Review failed' },
      { status: 400 },
    );
  }
}

export const GET = (request: Request) => handleFounderPilotRequests(request);
export const PATCH = (request: Request) => handleFounderPilotRequests(request);
