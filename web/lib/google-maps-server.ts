import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Position } from './territory-geometry.ts';

export type GeocodedAddress = {
  formattedAddress: string;
  center: Position;
};

function configuredValue(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) {
    return direct;
  }

  const envPath = path.resolve(process.cwd(), '..', '.env.local');
  if (!existsSync(envPath)) {
    return '';
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`));
    if (match) {
      return match[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return '';
}

export function getGoogleMapsBrowserKey(): string {
  return configuredValue('GOOGLE_MAPS_BROWSER_API_KEY');
}

function getGoogleMapsServerKey(): string {
  return (
    configuredValue('GOOGLE_MAPS_SERVER_API_KEY') || configuredValue('GOOGLE_MAPS_STATIC_API_KEY')
  );
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
