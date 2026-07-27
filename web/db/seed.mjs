import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateDatabase, openDatabase } from './migrate.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/temecula-segments.json', import.meta.url), 'utf8'),
);
const churchId = 'church-temecula-pilot';
const territoryId = 'territory-temecula-pilot';
const sampleSegment = fixture.segments[0];

export function seedDatabase(database) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare('INSERT OR IGNORE INTO churches (id, name) VALUES (?, ?)')
      .run(churchId, 'Temecula Pilot Church');
    database
      .prepare(
        `INSERT OR IGNORE INTO administrators
          (id, church_id, email, display_name) VALUES (?, ?, ?, ?)`,
      )
      .run('admin-local-founder', churchId, 'admin@streetlight.local', 'Local Administrator');
    database
      .prepare(
        `INSERT OR IGNORE INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        territoryId,
        churchId,
        'Temecula and Murrieta',
        fixture.territory.center[1],
        fixture.territory.center[0],
        fixture.territory.radius_miles * 1609.344,
        JSON.stringify(fixture.territory.boundary),
        fixture.territory.origin_address,
      );

    database
      .prepare(
        `UPDATE territories
        SET center_latitude = ?, center_longitude = ?, radius_meters = ?,
          boundary_geojson = ?, origin_address = ?
        WHERE id = ? AND origin_address = ''`,
      )
      .run(
        fixture.territory.center[1],
        fixture.territory.center[0],
        fixture.territory.radius_miles * 1609.344,
        JSON.stringify(fixture.territory.boundary),
        fixture.territory.origin_address,
        territoryId,
      );

    const insertSegment = database.prepare(
      `INSERT OR IGNORE INTO street_segments
        (id, church_id, territory_id, source_segment_id, street_name,
          geometry_geojson, estimated_homes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const segment of fixture.segments) {
      insertSegment.run(
        segment.id,
        churchId,
        territoryId,
        segment.source_segment_id,
        segment.street_name,
        JSON.stringify(segment.geometry),
        segment.estimated_homes,
      );
    }

    database
      .prepare(
        `INSERT OR IGNORE INTO batches
          (id, church_id, name, status, finalized_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'batch-foundation-001',
        churchId,
        'Foundation sample',
        'reconciled',
        '2026-07-27T12:00:00Z',
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO packets
          (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'packet-foundation-001',
        churchId,
        'batch-foundation-001',
        'TEM-FOUNDATION-001',
        fixture.territory.origin_address,
        sampleSegment.estimated_homes,
        'completed',
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO packet_segments
          (church_id, packet_id, street_segment_id, sequence_number)
          VALUES (?, ?, ?, ?)`,
      )
      .run(churchId, 'packet-foundation-001', sampleSegment.id, 0);
    database
      .prepare(
        `INSERT OR IGNORE INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind)
          VALUES (?, ?, ?, ?, ?)`,
      )
      .run('coverage-foundation-001', churchId, sampleSegment.id, '2026-07-27', 'completed');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

const isCommand =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isCommand) {
  const database = openDatabase();
  migrateDatabase(database);
  seedDatabase(database);
  database.close();
  console.log('Seeded Temecula pilot workspace');
}
