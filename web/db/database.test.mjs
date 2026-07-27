import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

test('migration and seed create the church-owned Phase 2 territory graph', () => {
  const database = openDatabase(':memory:');

  migrateDatabase(database);
  migrateDatabase(database);
  seedDatabase(database);
  seedDatabase(database);

  const expectedTables = [
    'churches',
    'administrators',
    'territories',
    'street_segments',
    'coverage_events',
    'batches',
    'packets',
    'packet_segments',
    'ignore_zones',
  ];

  for (const table of expectedTables) {
    const expected = table === 'street_segments' ? 55 : table === 'ignore_zones' ? 0 : 1;
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, expected);
  }

  const segments = database
    .prepare(
      `SELECT COUNT(*) AS count, SUM(estimated_homes) AS homes,
        COUNT(DISTINCT church_id) AS churches
      FROM street_segments
      WHERE church_id = ? AND territory_id = ?`,
    )
    .get('church-temecula-pilot', 'territory-temecula-pilot');

  assert.deepEqual({ ...segments }, { count: 55, homes: 427, churches: 1 });

  database.close();
});
