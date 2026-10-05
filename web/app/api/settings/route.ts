import { withAccountActivity } from '../../../lib/account-activity.ts';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import {
  getChurchPrintoutSettings,
  saveChurchPrintoutSettings,
} from '../../../lib/printout-settings-persistence.ts';
import { type ChurchPrintoutSettings, parseChurchPrintoutSettings } from '../../../lib/settings.ts';

export function getSettings(): Response {
  return Response.json(getChurchPrintoutSettings());
}

export async function updateSettings(request: Request): Promise<Response> {
  let settings: ChurchPrintoutSettings;
  try {
    settings = parseChurchPrintoutSettings(await request.json());
  } catch {
    return Response.json({ error: 'Invalid printout settings' }, { status: 400 });
  }
  try {
    return Response.json(saveChurchPrintoutSettings(settings));
  } catch {
    return withAccountActivity(
      Response.json({ error: 'Invalid printout settings' }, { status: 400 }),
      { outcome: 'failed' },
    );
  }
}

export const GET = authenticatedRoute(getSettings);
export const PATCH = authenticatedRoute(
  updateSettings,
  undefined,
  undefined,
  false,
  'printout_settings',
);
