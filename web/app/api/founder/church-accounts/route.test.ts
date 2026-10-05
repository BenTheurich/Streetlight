import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import type { FounderIdentityAdapter } from '../../../../lib/founder-church-accounts.ts';
import { handleFounderChurchAccounts } from './route.ts';

const founder: AuthLoader = async () => ({ user: { id: 'ben', email: 'bentheurich@gmail.com' } });
const provider: FounderIdentityAdapter = {
  async getInvitation() {
    throw new Error('unused');
  },
  async listMemberships() {
    return [];
  },
  async listInvitations() {
    return [];
  },
  async getUser() {
    throw new Error('unused');
  },
};

test('founder account and activity reads deny anonymous and other administrators before accessing data or WorkOS', async () => {
  let calls = 0;
  const spy = {
    ...provider,
    async listMemberships() {
      calls++;
      return [];
    },
  };
  for (const user of [null, { id: 'other', email: 'admin@example.test' }]) {
    for (const suffix of ['', '?churchId=some-church&before=2']) {
      const response = await handleFounderChurchAccounts(
        new Request(`https://test.local/api/founder/church-accounts${suffix}`),
        async () => ({ user }),
        spy,
        'missing.db',
      );
      assert.equal(response.status, 404);
    }
  }
  assert.equal(calls, 0);
});

test('founder account API validates cursors, returns no-store snapshots and paginates only the selected church', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'streetlight-founder-api-'));
  const filename = path.join(directory, 'test.db');
  const db = openDatabase(filename);
  migrateDatabase(db);
  db.prepare(
    "INSERT INTO churches (id,name) VALUES ('one','First church'),('two','Second church')",
  ).run();
  const insert = db.prepare(
    `INSERT INTO account_activity(church_id,user_id,action,outcome,recorded_at) VALUES (?, 'user', 'onboarding','succeeded',CURRENT_TIMESTAMP)`,
  );
  for (let i = 0; i < 52; i++) insert.run('one');
  insert.run('two');
  db.close();
  try {
    const get = (suffix = '') =>
      handleFounderChurchAccounts(
        new Request(`https://test.local/api/founder/church-accounts${suffix}`),
        founder,
        provider,
        filename,
      );
    for (const suffix of [
      '?before=2',
      '?churchId=one&before=0',
      '?churchId=one&before=-1',
      '?churchId=one&before=1.5',
      '?churchId=one&before=9007199254740992',
      '?churchId=one&churchId=two',
      '?unknown=one',
      '?churchId=',
    ])
      assert.equal((await get(suffix)).status, 400);
    const snapshot = await get();
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.headers.get('cache-control'), 'no-store');
    const value = await snapshot.json();
    assert.equal(value.churches.length, 2);
    const first = await (await get('?churchId=one')).json();
    assert.equal(first.activities.length, 50);
    assert.equal(first.hasMore, true);
    const older = await (await get(`?churchId=one&before=${first.activities.at(-1).id}`)).json();
    assert.equal(older.activities.length, 2);
    assert.equal(older.hasMore, false);
    assert.equal(
      older.activities.every((a: { churchId: string }) => a.churchId === 'one'),
      true,
    );
    assert.equal((await get('?churchId=missing')).status, 404);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
