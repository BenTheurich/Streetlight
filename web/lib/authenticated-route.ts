import { recordAccountActivity, recordAccountResponse } from './account-activity.ts';
import {
  type AdministratorSession,
  type AuthLoader,
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from './auth.ts';
import type { AccountAction } from './founder-account-types.ts';
import { runInWorkspace } from './workspace-scope.ts';

type RouteHandler = (request: Request) => Response | Promise<Response>;

export function authenticatedRoute(
  handler: RouteHandler,
  loadSession?: AuthLoader,
  filename?: string,
  allowIncomplete = false,
  action?: AccountAction,
): RouteHandler {
  return async (request) => {
    let session: AdministratorSession;
    try {
      session = await requireAdministratorSession(loadSession, filename);
    } catch (error) {
      if (error instanceof SignInRequiredError) {
        return Response.json({ error: error.message }, { status: 401 });
      }
      if (error instanceof ChurchWorkspaceAccessError) {
        return Response.json({ error: error.message }, { status: 403 });
      }
      return Response.json({ error: 'Could not authenticate request' }, { status: 500 });
    }
    if (!allowIncomplete && !session.onboardingCompleted) {
      return Response.json({ error: 'Complete Region Setup first' }, { status: 403 });
    }
    return runInWorkspace(session.workspace, async () => {
      const actor = { churchId: session.workspace.churchId, user: session.user };
      try {
        const response = await handler(request);
        return action ? recordAccountResponse(response, { ...actor, action }, filename) : response;
      } catch (error) {
        if (action) recordAccountActivity({ ...actor, action, outcome: 'failed' }, filename);
        throw error;
      }
    });
  };
}
