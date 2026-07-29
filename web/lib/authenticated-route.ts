import {
  type AdministratorSession,
  type AuthLoader,
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from './auth.ts';
import { runInWorkspace } from './workspace-scope.ts';

type RouteHandler = (request: Request) => Response | Promise<Response>;

export function authenticatedRoute(
  handler: RouteHandler,
  loadSession?: AuthLoader,
  filename?: string,
  allowIncomplete = false,
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
      return Response.json({ error: 'Complete territory setup first' }, { status: 403 });
    }
    return runInWorkspace(session.workspace, () => handler(request));
  };
}
