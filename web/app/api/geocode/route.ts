import { authenticatedRoute } from '@/lib/authenticated-route';
import { geocodeAddress } from '@/lib/google-maps-server';

export async function geocodeChurch(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    !('address' in body) ||
    typeof body.address !== 'string' ||
    body.address.trim().length === 0 ||
    body.address.length > 300
  ) {
    return Response.json({ error: 'Enter a church address' }, { status: 400 });
  }

  try {
    return Response.json(await geocodeAddress(body.address));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not resolve that address' },
      { status: 422 },
    );
  }
}

export const POST = authenticatedRoute(geocodeChurch);
