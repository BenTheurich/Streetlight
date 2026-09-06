import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('migration CLI uses the configured persistent database from any working directory', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-migrate-'));
  const filename = path.join(directory, 'volume', 'pilot.db');
  try {
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'migrate.mjs')], {
      cwd: directory,
      env: { ...process.env, STREETLIGHT_DATABASE_PATH: filename },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(directory, 'data', 'streetlight.db')), false);
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM churches').get().count, 0);
      database.prepare('SELECT client_hash FROM pilot_request_rate_limits').all();
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
