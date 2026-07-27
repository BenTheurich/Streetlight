import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { seedDatabase } from './seed.mjs';

test('migration and seed create the complete church-owned foundation graph', () => {
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
  ];

  for (const table of expectedTables) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
  }

  const graph = database
    .prepare(
      `SELECT c.id AS church_id, t.id AS territory_id, s.id AS segment_id,
        b.id AS batch_id, p.id AS packet_id, ps.sequence_number
      FROM churches c
      JOIN territories t ON t.church_id = c.id
      JOIN street_segments s ON s.territory_id = t.id AND s.church_id = c.id
      JOIN batches b ON b.church_id = c.id
      JOIN packets p ON p.batch_id = b.id AND p.church_id = c.id
      JOIN packet_segments ps ON ps.packet_id = p.id
        AND ps.street_segment_id = s.id
        AND ps.church_id = c.id`,
    )
    .get();

  assert.deepEqual(
    { ...graph },
    {
      church_id: 'church-temecula-pilot',
      territory_id: 'territory-temecula-pilot',
      segment_id: 'segment-foundation-001',
      batch_id: 'batch-foundation-001',
      packet_id: 'packet-foundation-001',
      sequence_number: 0,
    },
  );

  database.close();
});
