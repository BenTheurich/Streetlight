import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateDatabase, openDatabase } from './migrate.mjs';

const seedStatements = [
  {
    sql: 'INSERT OR IGNORE INTO churches (id, name) VALUES (?, ?)',
    values: ['church-temecula-pilot', 'Temecula Pilot Church'],
  },
  {
    sql: `INSERT OR IGNORE INTO administrators
      (id, church_id, email, display_name) VALUES (?, ?, ?, ?)`,
    values: [
      'admin-local-founder',
      'church-temecula-pilot',
      'admin@streetlight.local',
      'Local Administrator',
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO territories
      (id, church_id, name, center_latitude, center_longitude, radius_meters, boundary_geojson)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    values: [
      'territory-temecula-pilot',
      'church-temecula-pilot',
      'Temecula and Murrieta',
      33.54293,
      -117.116885,
      16093.4,
      '{"type":"Polygon","coordinates":[[[-117.29,33.40],[-116.94,33.40],[-116.94,33.69],[-117.29,33.69],[-117.29,33.40]]]}',
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO street_segments
      (id, church_id, territory_id, street_name, geometry_geojson, estimated_homes)
      VALUES (?, ?, ?, ?, ?, ?)`,
    values: [
      'segment-foundation-001',
      'church-temecula-pilot',
      'territory-temecula-pilot',
      'Nicolas Road',
      '{"type":"LineString","coordinates":[[-117.1172,33.5428],[-117.1162,33.5431]]}',
      12,
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO batches
      (id, church_id, name, status, finalized_at) VALUES (?, ?, ?, ?, ?)`,
    values: [
      'batch-foundation-001',
      'church-temecula-pilot',
      'Foundation sample',
      'reconciled',
      '2026-07-27T12:00:00Z',
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO packets
      (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    values: [
      'packet-foundation-001',
      'church-temecula-pilot',
      'batch-foundation-001',
      'TEM-FOUNDATION-001',
      '31087 Nicolas Rd, Temecula, CA 92591',
      12,
      'completed',
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO packet_segments
      (church_id, packet_id, street_segment_id, sequence_number) VALUES (?, ?, ?, ?)`,
    values: ['church-temecula-pilot', 'packet-foundation-001', 'segment-foundation-001', 0],
  },
  {
    sql: `INSERT OR IGNORE INTO coverage_events
      (id, church_id, street_segment_id, covered_on, kind) VALUES (?, ?, ?, ?, ?)`,
    values: [
      'coverage-foundation-001',
      'church-temecula-pilot',
      'segment-foundation-001',
      '2026-07-27',
      'completed',
    ],
  },
];

export function seedDatabase(database) {
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of seedStatements) {
      database.prepare(statement.sql).run(...statement.values);
    }
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
