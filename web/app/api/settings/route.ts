import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { getChurchPrintoutSettings, saveChurchPrintoutSettings } from '../../../lib/database.ts';

export function getSettings(): Response {
  return Response.json(getChurchPrintoutSettings());
}

export async function updateSettings(request: Request): Promise<Response> {
  try {
    return Response.json(saveChurchPrintoutSettings(await request.json()));
  } catch {
    return Response.json({ error: 'Invalid printout settings' }, { status: 400 });
  }
}

export const GET = authenticatedRoute(getSettings);
export const PATCH = authenticatedRoute(updateSettings);
