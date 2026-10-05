import { createHash } from 'node:crypto';
import { recordAccountResponse, withAccountActivity } from '../../../../lib/account-activity.ts';
import {
  type AuthLoader,
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '../../../../lib/auth.ts';
import {
  AdministratorAccessError,
  AdministratorActionError,
  listChurchAdministrators,
  mutateChurchAdministrator,
  parseAdministratorAction,
  type WorkOSAdministratorsAdapter,
} from '../../../../lib/church-administrators.ts';
import type { AccountAction } from '../../../../lib/founder-account-types.ts';

export async function handleChurchAdministrators(
  request: Request,
  loadSession?: AuthLoader,
  adapter?: WorkOSAdministratorsAdapter,
  filename?: string,
): Promise<Response> {
  let session: OrganizationSession | undefined;
  let activity: AccountAction | undefined;
  let targetId: string | null = null;
  try {
    session = await requireOrganizationSession(loadSession, filename);
    if (request.method === 'GET') {
      return Response.json(
        await listChurchAdministrators(session.organizationId, session.user.id, adapter),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (request.method !== 'PATCH')
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const origin = request.headers.get('origin');
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return Response.json({ error: 'Request origin is not allowed' }, { status: 403 });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return Response.json({ error: 'Send administrator actions as JSON' }, { status: 415 });
    }
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new AdministratorActionError('Invalid administrator action');
    }
    const action = parseAdministratorAction(input);
    targetId =
      action.action === 'invite'
        ? createHash('sha256').update(action.email).digest('hex')
        : action.id;
    activity =
      action.action === 'invite'
        ? 'administrator_invitation'
        : action.action === 'revoke'
          ? 'administrator_revocation'
          : 'administrator_removal';
    const result = await mutateChurchAdministrator(
      session.organizationId,
      session.user.id,
      action,
      adapter,
    );
    return recordAccountResponse(
      withAccountActivity(Response.json(result), {
        targetId,
      }),
      { churchId: session.access.churchId, user: session.user, action: activity },
      filename,
    );
  } catch (error) {
    if (error instanceof SignInRequiredError)
      return Response.json({ error: error.message }, { status: 401 });
    if (error instanceof ChurchWorkspaceAccessError || error instanceof AdministratorAccessError)
      return Response.json({ error: error.message }, { status: 403 });
    const response =
      error instanceof AdministratorActionError
        ? Response.json({ error: error.message }, { status: 400 })
        : Response.json(
            { error: 'Could not load or update administrators. Please try again.' },
            { status: 503 },
          );
    return session && activity
      ? recordAccountResponse(
          withAccountActivity(response, { targetId }),
          { churchId: session.access.churchId, user: session.user, action: activity },
          filename,
        )
      : response;
  }
}

export const GET = (request: Request) => handleChurchAdministrators(request);
export const PATCH = (request: Request) => handleChurchAdministrators(request);
