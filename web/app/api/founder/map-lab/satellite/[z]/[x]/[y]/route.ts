import type { AuthLoader } from '../../../../../../../../lib/auth.ts';
import {
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from '../../../../../../../../lib/auth.ts';
import { isFounderEmail } from '../../../../../../../../lib/founder-auth.ts';
import { googleSatellite } from '../../../../../../../../lib/google-satellite-tiles.ts';

type TileLoader = (
  zoom: number,
  x: number,
  y: number,
) => Promise<{
  bytes: Uint8Array;
  contentType: string;
  cacheControl?: string | null;
}>;

export async function handleSatelliteTile(
  request: Request,
  coordinates: { z: string; x: string; y: string },
  loadSession?: AuthLoader,
  tileLoader: TileLoader = googleSatellite.loadTile,
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
  try {
    const tile = await tileLoader(
      Number(coordinates.z),
      Number(coordinates.x),
      Number(coordinates.y),
    );
    return new Response(Uint8Array.from(tile.bytes).buffer, {
      headers: {
        'content-type': tile.contentType,
        'cache-control': tile.cacheControl ?? 'private, no-store',
      },
    });
  } catch {
    return Response.json({ error: 'Could not load satellite tile' }, { status: 502 });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  return handleSatelliteTile(request, await context.params);
}
