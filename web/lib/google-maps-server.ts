import type { Position } from './territory-geometry.ts';

export type GeocodedAddress = {
  formattedAddress: string;
  center: Position;
};

export function getGoogleMapsBrowserKey(): string {
  return process.env.GOOGLE_MAPS_BROWSER_API_KEY?.trim() ?? '';
}

export function getGoogleMapsServerKey(): string {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function geocodeAddress(
  address: string,
  fetcher: typeof fetch = fetch,
  apiKey = getGoogleMapsServerKey(),
): Promise<GeocodedAddress> {
  if (!apiKey) {
    throw new Error('Google server geocoding is not configured');
  }
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address.trim());
  url.searchParams.set('key', apiKey);
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error('Could not reach Google address lookup');
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.status !== 'OK' || !Array.isArray(payload.results)) {
    throw new Error('Could not resolve that church address');
  }
  const first = payload.results[0];
  if (
    !isRecord(first) ||
    typeof first.formatted_address !== 'string' ||
    !isRecord(first.geometry) ||
    !isRecord(first.geometry.location) ||
    typeof first.geometry.location.lat !== 'number' ||
    typeof first.geometry.location.lng !== 'number'
  ) {
    throw new Error('Google returned an invalid address result');
  }
  return {
    formattedAddress: first.formatted_address,
    center: [first.geometry.location.lng, first.geometry.location.lat],
  };
}
