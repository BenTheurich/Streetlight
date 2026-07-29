import { createInitialTerritory } from './database.ts';
import { type GeocodedAddress, geocodeAddress } from './google-maps-server.ts';

export type OnboardingInput = {
  churchName: string;
  address: string;
  timeZone: string;
};

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  const parsed = value.trim().replace(/\s+/g, ' ');
  if (!parsed || parsed.length > maximum) throw new Error(`${label} is invalid`);
  return parsed;
}

export function parseOnboardingInput(value: unknown): OnboardingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid onboarding request');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'address,churchName,timeZone') {
    throw new Error('Invalid onboarding request');
  }
  const timeZone = text(input.timeZone, 'Time zone', 100);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new Error('Time zone is invalid');
  }
  return {
    churchName: text(input.churchName, 'Church name', 160),
    address: text(input.address, 'Church address', 300),
    timeZone,
  };
}

export async function onboardChurch(
  organizationId: string,
  input: OnboardingInput,
  geocoder: (address: string) => Promise<GeocodedAddress> = geocodeAddress,
  filename?: string,
) {
  const parsed = parseOnboardingInput(input);
  const geocoded = await geocoder(parsed.address);
  const { territoryId } = createInitialTerritory(
    organizationId,
    {
      churchName: parsed.churchName,
      timeZone: parsed.timeZone,
      formattedAddress: geocoded.formattedAddress,
      center: geocoded.center,
    },
    filename,
  );
  return {
    territoryId,
    formattedAddress: geocoded.formattedAddress,
    center: geocoded.center,
    radiusMiles: 1 as const,
    boundaryShape: 'circle' as const,
  };
}
