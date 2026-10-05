import { recordAccountResponse, withAccountActivity } from '../../../lib/account-activity.ts';
import {
  type AuthLoader,
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '../../../lib/auth.ts';
import { type GeocodedAddress, geocodeAddress } from '../../../lib/google-maps-server.ts';
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
  const respond = (response: Response) =>
    recordAccountResponse(
      response,
      { churchId: session.access.churchId, user: session.user, action: 'onboarding' },
      filename,
    );
  if (session.access.territoryId) {
    return respond(
      Response.json({ error: 'Church onboarding is already complete' }, { status: 409 }),
    );
  }
  let lookupAttempted = false;
  try {
    const result = await onboardChurch(
      session.organizationId,
      await request.json(),
      async (address) => {
        lookupAttempted = true;
        return (geocoder ?? geocodeAddress)(address);
      },
      filename,
    );
    return respond(
      withAccountActivity(Response.json(result, { status: 201 }), { targetId: result.territoryId }),
    );
  } catch (error) {
    return respond(
      withAccountActivity(
        Response.json(
          { error: error instanceof Error ? error.message : 'Could not complete onboarding' },
          { status: 400 },
        ),
        { outcome: lookupAttempted ? 'failed' : 'rejected' },
      ),
    );
  }
}

export const POST = (request: Request) => handleOnboarding(request);
