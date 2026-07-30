import type { AuthLoader } from '../../../../../lib/auth.ts';
import {
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from '../../../../../lib/auth.ts';
import { isFounderEmail } from '../../../../../lib/founder-auth.ts';
import {
  type GoogleSatelliteClient,
  googleSatellite,
} from '../../../../../lib/google-satellite-tiles.ts';

export async function handleSatelliteAttribution(
  request: Request,
  loadSession?: AuthLoader,
  loadCopyright: GoogleSatelliteClient['loadCopyright'] = googleSatellite.loadCopyright,
  filename?: string,
  founderEmail?: string,
): Promise<Response> {
  try {
    const session = await requireAdministratorSession(loadSession, filename);
    if (!isFounderEmail(session.user.email, founderEmail)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof SignInRequiredError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ChurchWorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: 'Could not authenticate request' }, { status: 500 });
  }
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const search = new URL(request.url).searchParams;
  if (
    [...search.keys()].sort().join(',') !== 'east,north,south,west,zoom' ||
    [...search.values()].some((value) => value.trim() === '')
  ) {
    return Response.json({ error: 'Invalid satellite viewport' }, { status: 400 });
  }
  try {
    return Response.json({
      copyright: await loadCopyright({
        zoom: Number(search.get('zoom')),
        north: Number(search.get('north')),
        south: Number(search.get('south')),
        east: Number(search.get('east')),
        west: Number(search.get('west')),
      }),
    });
  } catch {
    return Response.json({ error: 'Could not load satellite attribution' }, { status: 502 });
  }
}

export const GET = (request: Request) => handleSatelliteAttribution(request);
export const POST = (request: Request) => handleSatelliteAttribution(request);
