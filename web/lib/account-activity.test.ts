import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import {
  recordAccountActivity,
  recordAccountResponse,
  withAccountActivity,
} from './account-activity.ts';

test('activity stores verified attribution, safe targets, and server time without changing responses', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-account-activity-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    database.exec("INSERT INTO churches (id, name) VALUES ('church-a', 'Church A')");
    const input = {
      churchId: 'church-a',
      user: {
        id: 'user-verified',
        email: 'verified@example.com',
        firstName: 'Ben',
        lastName: 'Theurich',
      },
      action: 'pdf_preparation' as const,
    };
    const earliest = new Date().toISOString();
    const response = withAccountActivity(new Response(new Uint8Array([1, 2, 3])), {
      targetId: 'batch-1',
    });
    assert.equal(recordAccountResponse(response, input, filename), response);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(
      [...response.headers.keys()].some((name) => name.includes('activity')),
      false,
    );
    recordAccountResponse(
      withAccountActivity(Response.json({ error: 'private failure detail' }, { status: 422 }), {
        outcome: 'failed',
        targetId: 'active',
      }),
      input,
      filename,
    );
    recordAccountActivity(
      { ...input, outcome: 'rejected', targetId: 'a raw address or private request body' },
      filename,
    );
    const rows = database.prepare('SELECT * FROM account_activity ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map(({ church_id, user_id, actor_name, actor_email, action, outcome, target_id }) => ({
        church_id,
        user_id,
        actor_name,
        actor_email,
        action,
        outcome,
        target_id,
      })),
      ['succeeded', 'failed', 'rejected'].map((outcome, index) => ({
        church_id: 'church-a',
        user_id: 'user-verified',
        actor_name: 'Ben Theurich',
        actor_email: 'verified@example.com',
        action: 'pdf_preparation',
        outcome,
        target_id: index === 0 ? 'batch-1' : index === 1 ? 'active' : null,
      })),
    );
    for (const row of rows) {
      assert.ok(String(row.recorded_at) >= earliest);
      assert.ok(String(row.recorded_at) <= new Date().toISOString());
    }
    assert.doesNotMatch(JSON.stringify(rows), /private failure detail|raw address|request body/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
