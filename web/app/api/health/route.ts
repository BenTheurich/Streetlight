import { DatabaseSync } from 'node:sqlite';
import { workspaceDatabaseFilename } from '../../../lib/sqlite-persistence.ts';

export const dynamic = 'force-dynamic';

export function applicationHealth(filename = workspaceDatabaseFilename()): Response {
  let database: DatabaseSync | undefined;
  try {
    // Do not create an empty database when the persistent volume is unavailable.
    database = new DatabaseSync(filename, { readOnly: true });
    database.prepare('SELECT id FROM churches LIMIT 1').get();
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    database?.close();
  }
}

export function GET(): Response {
  return applicationHealth();
}
