import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { submitPublicPilotRequest } from './route.ts';

function request(body: unknown): Request {
  return new Request('http://streetlight.local/api/pilot-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const valid = {
  churchName: 'Grace Community',
  contactName: 'Ada Lovelace',
  email: 'ada@example.com',
  location: 'Temecula, CA',
  outreachProcess: '',
  website: '',
};

test('public pilot request route stores one request and returns neutral duplicate success', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-public-pilot-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();
  try {
    const first = await submitPublicPilotRequest(request(valid), filename);
    const duplicate = await submitPublicPilotRequest(
      request({ ...valid, churchName: ' grace  community ', email: 'ADA@example.com' }),
      filename,
    );
    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await first.json(), {
      message: "Request received. We'll review it and contact you at ada@example.com.",
    });
    assert.deepEqual(await duplicate.json(), {
      message: "Request received. We'll review it and contact you at ada@example.com.",
    });
    const check = openDatabase(filename);
    assert.equal(
      (check.prepare('SELECT COUNT(*) AS count FROM pilot_requests').get() as { count: number })
        .count,
      1,
    );
    check.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('public pilot request route rejects malformed and honeypot submissions', async () => {
  const invalid = await submitPublicPilotRequest(request({ ...valid, email: 'bad' }), ':memory:');
  const spam = await submitPublicPilotRequest(
    request({ ...valid, website: 'https://spam.example' }),
    ':memory:',
  );
  assert.equal(invalid.status, 400);
  assert.equal(spam.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Enter a valid email' });
  assert.deepEqual(await spam.json(), { error: 'Invalid request' });
});
