import {
  type AuthLoader,
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '../../../lib/auth.ts';
import type { GeocodedAddress } from '../../../lib/google-maps-server.ts';
import { onboardChurch } from '../../../lib/onboarding.ts';

export async function handleOnboarding(
  request: Request,
  loadSession?: AuthLoader,
  geocoder?: (address: string) => Promise<GeocodedAddress>,
  filename?: string,
): Promise<Response> {
  let session: OrganizationSession;
  try {
    session = await requireOrganizationSession(loadSession, filename);
  } catch (error) {
    if (error instanceof SignInRequiredError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ChurchWorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: 'Could not authenticate request' }, { status: 500 });
  }
  if (session.access.territoryId) {
    return Response.json({ error: 'Church onboarding is already complete' }, { status: 409 });
  }
  try {
    return Response.json(
      await onboardChurch(session.organizationId, await request.json(), geocoder, filename),
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not complete onboarding' },
      { status: 400 },
    );
  }
}

export const POST = (request: Request) => handleOnboarding(request);
