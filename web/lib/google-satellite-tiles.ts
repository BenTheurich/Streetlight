import { getGoogleMapsServerKey } from './google-maps-server.ts';

type SatelliteTile = {
  bytes: Uint8Array;
  contentType: string;
  cacheControl: string | null;
};

export type GoogleSatelliteClient = {
  loadTile: (zoom: number, x: number, y: number) => Promise<SatelliteTile>;
  loadCopyright: (viewport: {
    zoom: number;
    north: number;
    south: number;
    east: number;
    west: number;
  }) => Promise<string>;
};

export function createGoogleSatelliteClient(
  fetcher: typeof fetch = fetch,
  apiKey = getGoogleMapsServerKey(),
  now: () => number = Date.now,
): GoogleSatelliteClient {
  let session: { token: string; expiresAt: number } | null = null;

  async function sessionToken(): Promise<string> {
    if (!apiKey) throw new Error('Google satellite tiles are not configured');
    if (session && session.expiresAt > now() + 60_000) return session.token;
    const url = new URL('https://tile.googleapis.com/v1/createSession');
    url.searchParams.set('key', apiKey);
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
    });
    const value = (await response.json()) as { session?: unknown; expiry?: unknown };
    if (!response.ok || typeof value.session !== 'string' || typeof value.expiry !== 'string') {
      throw new Error('Could not start Google satellite session');
    }
    session = { token: value.session, expiresAt: Number(value.expiry) * 1_000 };
    return session.token;
  }

  return {
    async loadTile(zoom, x, y) {
      const tileLimit = 2 ** zoom;
      if (
        !Number.isInteger(zoom) ||
        zoom < 0 ||
        zoom > 22 ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= tileLimit ||
        y >= tileLimit
      ) {
        throw new Error('Invalid tile coordinates');
      }
      const token = await sessionToken();
      const url = new URL(`https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}`);
      url.searchParams.set('session', token);
      url.searchParams.set('key', apiKey);
      const response = await fetcher(url);
      if (!response.ok) throw new Error('Could not load Google satellite tile');
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'image/jpeg',
        cacheControl: response.headers.get('cache-control'),
      };
    },
    async loadCopyright(viewport) {
      if (
        !Number.isInteger(viewport.zoom) ||
        viewport.zoom < 0 ||
        viewport.zoom > 22 ||
        ![viewport.north, viewport.south, viewport.east, viewport.west].every(Number.isFinite) ||
        viewport.north <= viewport.south ||
        viewport.north >= 90 ||
        viewport.south <= -90 ||
        viewport.east > 180 ||
        viewport.east < -180 ||
        viewport.west > 180 ||
        viewport.west < -180
      ) {
        throw new Error('Invalid satellite viewport');
      }
      const token = await sessionToken();
      const url = new URL('https://tile.googleapis.com/tile/v1/viewport');
      url.searchParams.set('session', token);
      url.searchParams.set('key', apiKey);
      for (const [key, value] of Object.entries(viewport)) {
        url.searchParams.set(key, String(value));
      }
      const response = await fetcher(url);
      const value = (await response.json()) as { copyright?: unknown };
      if (!response.ok || typeof value.copyright !== 'string' || !value.copyright.trim()) {
        throw new Error('Could not load Google satellite attribution');
      }
      return value.copyright;
    },
  };
}

export const googleSatellite = createGoogleSatelliteClient();
