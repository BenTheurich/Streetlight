import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { APARTMENTS_ENABLED } from '../../../../lib/product-capabilities.ts';
import {
  saveApartmentSiteConfiguration,
  saveApartmentSiteMembership,
} from '../../../../lib/territory-persistence.ts';
import {
  type ApartmentSiteConfigurationInput,
  ApartmentSiteError,
  type ApartmentSiteMembershipInput,
} from '../../../../lib/territory-workspace.ts';

export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function parseConfiguration(value: unknown): ApartmentSiteConfigurationInput {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'accessStatus',
      'address',
      'addressConfirmed',
      'groupingConfirmed',
      'id',
      'includedInPackets',
      'name',
      'tractCount',
    ])
  ) {
    throw new Error('Invalid apartment site configuration');
  }
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > 200 ||
    !(
      value.name === null ||
      (typeof value.name === 'string' && value.name.trim() && value.name.length <= 120)
    ) ||
    !(
      value.address === null ||
      (typeof value.address === 'string' && value.address.trim() && value.address.length <= 240)
    ) ||
    typeof value.addressConfirmed !== 'boolean' ||
    !(
      value.tractCount === null ||
      (Number.isSafeInteger(value.tractCount) && (value.tractCount as number) >= 1)
    ) ||
    (value.accessStatus !== 'unknown' &&
      value.accessStatus !== 'open' &&
      value.accessStatus !== 'restricted') ||
    typeof value.groupingConfirmed !== 'boolean' ||
    typeof value.includedInPackets !== 'boolean'
  ) {
    throw new Error('Invalid apartment site configuration');
  }
  return value as ApartmentSiteConfigurationInput;
}

function parseMembership(value: unknown): ApartmentSiteMembershipInput {
  if (!isRecord(value) || !exactKeys(value, ['id', 'memberIds'])) {
    throw new Error('Invalid apartment site membership');
  }
  if (
    !(
      value.id === null ||
      (typeof value.id === 'string' && value.id.trim() && value.id.length <= 200)
    ) ||
    !Array.isArray(value.memberIds) ||
    value.memberIds.length === 0 ||
    value.memberIds.length > 200 ||
    value.memberIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) ||
    new Set(value.memberIds).size !== value.memberIds.length
  ) {
    throw new Error('Invalid apartment site membership');
  }
  return value as ApartmentSiteMembershipInput;
}

function domainError(error: unknown, fallback: string): Response {
  if (error instanceof ApartmentSiteError) {
    return Response.json(
      { error: error.message },
      { status: error.code === 'not_found' ? 404 : error.code === 'invalid' ? 400 : 409 },
    );
  }
  return Response.json({ error: fallback }, { status: 500 });
}

export async function updateApartmentSiteConfiguration(
  request: Request,
  apartmentsEnabled = APARTMENTS_ENABLED,
) {
  if (!apartmentsEnabled) {
    return Response.json({ error: 'Apartments are coming later' }, { status: 404 });
  }

  let input: ApartmentSiteConfigurationInput;
  try {
    input = parseConfiguration(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid apartment site configuration' },
      { status: 400 },
    );
  }
  try {
    return Response.json(saveApartmentSiteConfiguration(input));
  } catch (error) {
    return domainError(error, 'Could not save apartment site configuration');
  }
}

export async function updateApartmentSiteMembership(
  request: Request,
  apartmentsEnabled = APARTMENTS_ENABLED,
) {
  if (!apartmentsEnabled) {
    return Response.json({ error: 'Apartments are coming later' }, { status: 404 });
  }

  let input: ApartmentSiteMembershipInput;
  try {
    input = parseMembership(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid apartment site membership' },
      { status: 400 },
    );
  }
  try {
    return Response.json(saveApartmentSiteMembership(input));
  } catch (error) {
    return domainError(error, 'Could not save apartment site membership');
  }
}

export const PATCH = authenticatedRoute(
  updateApartmentSiteConfiguration,
  undefined,
  undefined,
  true,
);
export const POST = authenticatedRoute(updateApartmentSiteMembership, undefined, undefined, true);
