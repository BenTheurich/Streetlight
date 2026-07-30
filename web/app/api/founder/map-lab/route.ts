import type { AdministratorSession, AuthLoader } from '../../../../lib/auth.ts';
import {
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from '../../../../lib/auth.ts';
import { getMapLabData } from '../../../../lib/database.ts';
import { isFounderEmail } from '../../../../lib/founder-auth.ts';
import { runInWorkspace } from '../../../../lib/workspace-scope.ts';

export async function handleMapLabData(
  request: Request,
  loadSession?: AuthLoader,
  filename?: string,
  founderEmail?: string,
): Promise<Response> {
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
  if (!isFounderEmail(session.user.email, founderEmail)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  if ([...new URL(request.url).searchParams].length > 0) {
    return Response.json({ error: 'Church overrides are not allowed' }, { status: 400 });
  }
  return runInWorkspace(session.workspace, () => Response.json(getMapLabData(filename)));
}

export const GET = (request: Request) => handleMapLabData(request);
export const POST = (request: Request) => handleMapLabData(request);
export const PUT = (request: Request) => handleMapLabData(request);
export const PATCH = (request: Request) => handleMapLabData(request);
export const DELETE = (request: Request) => handleMapLabData(request);
