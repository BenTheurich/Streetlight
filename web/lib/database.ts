import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type SummaryRow = {
  church_name: string;
  territory_name: string;
  segment_count: number;
  estimated_homes: number;
  packet_count: number;
};

export type FoundationSummary = {
  churchName: string;
  territoryName: string;
  segmentCount: number;
  estimatedHomes: number;
  packetCount: number;
};

export function getFoundationSummary(): FoundationSummary {
  const database = new DatabaseSync(path.join(process.cwd(), 'data', 'streetlight.db'), {
    readOnly: true,
  });

  try {
    const row = database
      .prepare(
        `SELECT
          c.name AS church_name,
          t.name AS territory_name,
          (SELECT COUNT(*) FROM street_segments s WHERE s.church_id = c.id) AS segment_count,
          (SELECT COALESCE(SUM(s.estimated_homes), 0) FROM street_segments s WHERE s.church_id = c.id) AS estimated_homes,
          (SELECT COUNT(*) FROM packets p WHERE p.church_id = c.id) AS packet_count
        FROM churches c
        JOIN territories t ON t.church_id = c.id
        ORDER BY c.created_at
        LIMIT 1`,
      )
      .get() as SummaryRow | undefined;

    if (!row) {
      throw new Error('No local workspace found. Run pnpm db:seed.');
    }

    return {
      churchName: row.church_name,
      territoryName: row.territory_name,
      segmentCount: row.segment_count,
      estimatedHomes: row.estimated_homes,
      packetCount: row.packet_count,
    };
  } finally {
    database.close();
  }
}
