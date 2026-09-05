import type { AuthLoader } from '../../../lib/auth.ts';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { getOpenMapData } from '../../../lib/open-map-persistence.ts';

export function handleMapData(request: Request, loadSession?: AuthLoader, filename?: string) {
  return authenticatedRoute(
    (authenticatedRequest) => {
      if (authenticatedRequest.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
      }
      if ([...new URL(authenticatedRequest.url).searchParams].length > 0) {
        return Response.json({ error: 'Church overrides are not allowed' }, { status: 400 });
      }
      return Response.json(getOpenMapData(filename));
    },
    loadSession,
    filename,
    true,
  )(request);
}

export const GET = (request: Request) => handleMapData(request);
export const POST = (request: Request) => handleMapData(request);
export const PUT = (request: Request) => handleMapData(request);
export const PATCH = (request: Request) => handleMapData(request);
export const DELETE = (request: Request) => handleMapData(request);
