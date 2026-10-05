import type { AuthLoader } from '../../../../lib/auth.ts';
import { FounderAccessNotFoundError, requireFounderSession } from '../../../../lib/founder-auth.ts';
import {
  type FounderIdentityAdapter,
  listFounderChurchAccounts,
  readFounderAccountActivities,
} from '../../../../lib/founder-church-accounts.ts';

export async function handleFounderChurchAccounts(
  request: Request,
  loadSession?: AuthLoader,
  adapter?: FounderIdentityAdapter,
  filename?: string,
): Promise<Response> {
  try {
    await requireFounderSession(loadSession);
  } catch (error) {
    if (error instanceof FounderAccessNotFoundError)
      return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ error: 'Could not authenticate request' }, { status: 500 });
  }
  if (request.method !== 'GET')
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some(
      (key) => !['churchId', 'before'].includes(key) || query.getAll(key).length !== 1,
    ) ||
    (query.has('before') && !query.has('churchId')) ||
    (query.has('churchId') && !query.get('churchId')?.trim()) ||
    (query.has('before') && !/^[1-9]\d*$/.test(query.get('before') ?? ''))
  )
    return Response.json({ error: 'Invalid activity selection' }, { status: 400 });
  const before = query.has('before') ? Number(query.get('before')) : undefined;
  if (before !== undefined && !Number.isSafeInteger(before))
    return Response.json({ error: 'Invalid activity selection' }, { status: 400 });
  try {
    const value = query.has('churchId')
      ? readFounderAccountActivities(query.get('churchId') as string, before, filename)
      : await listFounderChurchAccounts(filename, adapter);
    return Response.json(value, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Church not found')
      return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(
      { error: 'Could not load church accounts. Refresh to try again.' },
      { status: 500 },
    );
  }
}

export const GET = (request: Request) => handleFounderChurchAccounts(request);
