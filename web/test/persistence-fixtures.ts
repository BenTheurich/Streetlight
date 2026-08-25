import { randomUUID } from 'node:crypto';
import { openDatabase } from '../db/migrate.mjs';
import { requireWorkspaceScope } from '../lib/workspace-scope.ts';

export function insertCoverageCompletionFixture(
  segmentId: string,
  coveredOn: string,
  filename: string,
): string {
  const scope = requireWorkspaceScope();
  const database = openDatabase(filename);
  try {
    const segment = database
      .prepare(
        `SELECT id FROM street_segments
        WHERE church_id = ? AND territory_id = ? AND import_segment_id = ? AND is_current = 1`,
      )
      .get(scope.churchId, scope.territoryId, segmentId) as { id: string } | undefined;
    if (!segment) throw new Error('Street segment not found');
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
        VALUES (?, ?, ?, ?, 'completed')`,
      )
      .run(id, scope.churchId, segment.id, coveredOn);
    return id;
  } finally {
    database.close();
  }
}
