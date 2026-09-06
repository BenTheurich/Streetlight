import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateDatabase, openDatabase } from './migrate.mjs';
import { copyDatabase } from './recovery.mjs';
import { seedDatabase } from './seed.mjs';

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-recovery-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function seedHistory(database) {
  migrateDatabase(database);
  seedDatabase(database, { authOrganizationId: 'org_recovery_test' });
  database.exec(`
    INSERT INTO batches (id, church_id, name, status, finalized_at)
    VALUES ('recovery-batch', 'church-temecula-pilot', 'Recovery proof', 'reconciled', CURRENT_TIMESTAMP);
    INSERT INTO packets
      (id, church_id, batch_id, packet_code, start_address, estimated_homes, status)
    VALUES ('recovery-packet', 'church-temecula-pilot', 'recovery-batch', 'RECOVERY', 'Test Road', 1, 'completed');
    INSERT INTO packet_segments (church_id, packet_id, street_segment_id, sequence_number)
    SELECT church_id, 'recovery-packet', id, 0 FROM street_segments ORDER BY id LIMIT 1;
    INSERT INTO coverage_events
      (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind)
    SELECT 'recovery-completed', church_id, street_segment_id, packet_id, 'recovery-group', '2026-09-01', 'completed'
    FROM packet_segments WHERE packet_id = 'recovery-packet';
    INSERT INTO coverage_events
      (id, church_id, street_segment_id, packet_id, completion_group_id, covered_on, kind, corrects_event_id)
    SELECT 'recovery-correction', church_id, street_segment_id, packet_id, completion_group_id,
      '2026-09-02', 'correction', id FROM coverage_events WHERE id = 'recovery-completed';
  `);
}

function runCommand(...args) {
  return spawnSync(process.execPath, [path.join(import.meta.dirname, 'recovery.mjs'), ...args], {
    encoding: 'utf8',
  });
}

test('backup and restore retain committed WAL data, packet history, and append-only protection', (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'source.db');
  const backupPath = path.join(directory, 'backup.db');
  const restoredPath = path.join(directory, 'restored.db');
  const source = openDatabase(sourcePath);
  try {
    source.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
    seedHistory(source);
    assert.ok(existsSync(`${sourcePath}-wal`));
    const expectedHistory = source.prepare('SELECT * FROM coverage_events ORDER BY rowid').all();
    const backupResult = runCommand('backup', sourcePath, backupPath);
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backupReport = JSON.parse(backupResult.stdout);
    assert.equal(backupReport.integrity, 'ok');
    assert.equal(backupReport.counts.churches, 1);
    assert.equal(backupReport.counts.street_segments, 55);
    assert.equal(backupReport.counts.packets, 1);
    assert.equal(backupReport.counts.coverage_events, 2);
    const backupBytes = readFileSync(backupPath);

    source.exec("UPDATE churches SET name = 'Later source change'");
    const restoreResult = runCommand('restore', backupPath, restoredPath);
    assert.equal(restoreResult.status, 0, restoreResult.stderr);
    assert.deepEqual(JSON.parse(restoreResult.stdout).counts, backupReport.counts);
    assert.deepEqual(readFileSync(backupPath), backupBytes);

    const restored = openDatabase(restoredPath);
    try {
      assert.equal(
        restored.prepare('SELECT name FROM churches').get().name,
        'Temecula Pilot Church',
      );
      assert.equal(
        restored.prepare('SELECT auth_organization_id FROM churches').get().auth_organization_id,
        'org_recovery_test',
      );
      assert.equal(restored.prepare('SELECT status FROM packets').get().status, 'completed');
      assert.deepEqual(
        restored.prepare('SELECT * FROM coverage_events ORDER BY rowid').all(),
        expectedHistory,
      );
      assert.throws(() => restored.exec('DELETE FROM coverage_events'), /append-only/);
      restored.exec("UPDATE churches SET name = 'Restored copy change'");
    } finally {
      restored.close();
    }
    assert.equal(source.prepare('SELECT name FROM churches').get().name, 'Later source change');
    assert.deepEqual(
      source.prepare('SELECT * FROM coverage_events ORDER BY rowid').all(),
      expectedHistory,
    );
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('.streetlight-')),
      [],
    );
  } finally {
    source.close();
  }
});

test('recovery refuses source, existing destination, and orphaned SQLite sidecar paths without changing them', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'source.db');
  const source = openDatabase(sourcePath);
  seedHistory(source);
  source.close();
  const sourceBytes = readFileSync(sourcePath);
  await assert.rejects(copyDatabase(sourcePath, sourcePath), /Destination already exists/);
  const target = path.join(directory, 'existing.db');
  writeFileSync(target, 'preserve this file');
  await assert.rejects(copyDatabase(sourcePath, target), /Destination already exists/);
  assert.equal(readFileSync(target, 'utf8'), 'preserve this file');
  const sidecarTarget = path.join(directory, 'orphaned.db');
  writeFileSync(`${sidecarTarget}-wal`, 'preserve this journal');
  await assert.rejects(copyDatabase(sourcePath, sidecarTarget), /Destination already exists/);
  assert.equal(readFileSync(`${sidecarTarget}-wal`, 'utf8'), 'preserve this journal');
  assert.equal(existsSync(sidecarTarget), false);
  assert.deepEqual(readFileSync(sourcePath), sourceBytes);
});

test('missing, corrupt, and foreign-key-invalid sources never publish a restored copy', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'restored.db');
  await assert.rejects(copyDatabase(path.join(directory, 'missing.db'), destination));
  const corrupt = path.join(directory, 'corrupt.db');
  writeFileSync(corrupt, 'not a SQLite database');
  await assert.rejects(copyDatabase(corrupt, destination), /not a database/);
  const invalid = path.join(directory, 'invalid.db');
  const database = new DatabaseSync(invalid);
  try {
    seedHistory(database);
    database.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO administrators (id, church_id, email, display_name)
      VALUES ('orphan', 'missing-church', 'test@example.test', 'Test');
    `);
  } finally {
    database.close();
  }
  await assert.rejects(copyDatabase(invalid, destination), /foreign-key check failed/);
  const invalidConstraints = new DatabaseSync(invalid);
  try {
    invalidConstraints.exec(`
      DELETE FROM administrators WHERE id = 'orphan';
      PRAGMA ignore_check_constraints = ON;
      UPDATE street_segments SET estimated_homes = -1;
    `);
  } finally {
    invalidConstraints.close();
  }
  await assert.rejects(copyDatabase(invalid, destination), /integrity check failed/);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(path.join(directory, 'missing.db')), false);
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.startsWith('.streetlight-')),
    [],
  );
});

test('CLI requires an operation and explicit source and destination paths', () => {
  const result = runCommand('restore');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
