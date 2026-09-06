import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { migrateDatabase, openDatabase } from '../../../db/migrate.mjs';
import { POST, submitPublicPilotRequest } from './route.ts';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://streetlight.local/api/pilot-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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

function cloudflareDatabase(context: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-request-limit-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();
  const previous = process.env.STREETLIGHT_TRUST_CLOUDFLARE;
  process.env.STREETLIGHT_TRUST_CLOUDFLARE = '1';
  context.after(() => {
    if (previous === undefined) delete process.env.STREETLIGHT_TRUST_CLOUDFLARE;
    else process.env.STREETLIGHT_TRUST_CLOUDFLARE = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  return filename;
}

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
    assert.equal(first.status, 200);
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

test('Cloudflare allows five neutral duplicates and persists its limit while ignoring spoofed forwarding headers', async (context) => {
  const filename = cloudflareDatabase(context);
  context.mock.method(Date, 'now', () => Date.parse('2026-09-06T12:34:56.250Z'));
  const expected = {
    message: "Request received. We'll review it and contact you at ada@example.com.",
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await submitPublicPilotRequest(
      request(valid, {
        'cf-connecting-ip': '192.0.2.1',
        'x-forwarded-for': `198.51.100.${attempt}`,
        'x-real-ip': `203.0.113.${attempt}`,
      }),
      filename,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }

  for (let attempt = 6; attempt <= 7; attempt++) {
    const response = await submitPublicPilotRequest(
      request(valid, {
        'cf-connecting-ip': '192.0.2.1',
        'x-forwarded-for': `198.51.100.${attempt}`,
        'x-real-ip': `203.0.113.${attempt}`,
      }),
      filename,
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '1504');
    assert.deepEqual(await response.json(), {
      error: 'Too many requests. Please try again later.',
    });
  }

  const otherClient = await submitPublicPilotRequest(
    request(valid, { 'cf-connecting-ip': '192.0.2.2', 'x-forwarded-for': '198.51.100.1' }),
    filename,
  );
  assert.equal(otherClient.status, 200);
  const database = openDatabase(filename);
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM pilot_requests').get()?.count, 1);
    assert.deepEqual(
      database
        .prepare('SELECT request_count FROM pilot_request_rate_limits ORDER BY request_count')
        .all()
        .map((row) => row.request_count),
      [1, 5],
    );
  } finally {
    database.close();
  }
});

test('Cloudflare resets at the fixed-hour boundary and removes all expired client windows', async (context) => {
  const filename = cloudflareDatabase(context);
  let now = Date.parse('2026-09-06T12:59:59.999Z');
  context.mock.method(Date, 'now', () => now);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(
      (
        await submitPublicPilotRequest(
          request(valid, { 'cf-connecting-ip': '192.0.2.1' }),
          filename,
        )
      ).status,
      200,
    );
  }
  await submitPublicPilotRequest(request(valid, { 'cf-connecting-ip': '192.0.2.2' }), filename);
  const limited = await submitPublicPilotRequest(
    request(valid, { 'cf-connecting-ip': '192.0.2.1' }),
    filename,
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');

  now++;
  const renewed = await submitPublicPilotRequest(
    request(valid, { 'cf-connecting-ip': '192.0.2.1' }),
    filename,
  );
  assert.equal(renewed.status, 200);
  const database = openDatabase(filename);
  try {
    const rows = database.prepare('SELECT * FROM pilot_request_rate_limits').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].request_count, 1);
    assert.equal(rows[0].window_ends_at, Date.parse('2026-09-06T14:00:00Z'));
  } finally {
    database.close();
  }
});

test('Cloudflare rejects missing or malformed CF-Connecting-IP without falling back to X-Forwarded-For', async (context) => {
  const filename = cloudflareDatabase(context);
  for (const address of [
    undefined,
    '',
    'unknown',
    '192.0.2.1, 192.0.2.2',
    '192.0.2.1:443',
    '999.0.2.1',
    'fe80::1%eth0',
  ]) {
    const headers: Record<string, string> = { 'x-forwarded-for': '192.0.2.1' };
    if (address !== undefined) headers['cf-connecting-ip'] = address;
    const response = await submitPublicPilotRequest(request(valid, headers), filename);
    assert.equal(response.status, 503, `Untrusted client address: ${address}`);
  }
  const database = openDatabase(filename);
  try {
    for (const table of ['pilot_requests', 'pilot_request_rate_limits']) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
    }
  } finally {
    database.close();
  }
});

test('Cloudflare canonicalizes IPv6 and counts invalid submissions before body validation', async (context) => {
  const filename = cloudflareDatabase(context);
  const addresses = ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001'];
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await submitPublicPilotRequest(
      request({ ...valid, email: 'bad' }, { 'cf-connecting-ip': addresses[attempt % 2] }),
      filename,
    );
    assert.equal(response.status, 400);
  }
  const limited = await submitPublicPilotRequest(
    request(valid, { 'cf-connecting-ip': addresses[1] }),
    filename,
  );
  assert.equal(limited.status, 429);
});

test('production rejects public submissions when its trusted proxy is not configured', async (context) => {
  const filename = cloudflareDatabase(context);
  delete process.env.STREETLIGHT_TRUST_CLOUDFLARE;
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.NODE_ENV;
  environment.NODE_ENV = 'production';
  context.after(() => {
    if (previous === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previous;
  });
  const response = await submitPublicPilotRequest(
    request(valid, { 'cf-connecting-ip': '192.0.2.1' }),
    filename,
  );
  assert.equal(response.status, 503);
});

test('local POST remains usable without Cloudflare and ignores arbitrary client-IP headers', async (context) => {
  const filename = cloudflareDatabase(context);
  delete process.env.STREETLIGHT_TRUST_CLOUDFLARE;
  const previousDatabase = process.env.STREETLIGHT_DATABASE_PATH;
  process.env.STREETLIGHT_DATABASE_PATH = filename;
  context.after(() => {
    if (previousDatabase === undefined) delete process.env.STREETLIGHT_DATABASE_PATH;
    else process.env.STREETLIGHT_DATABASE_PATH = previousDatabase;
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await POST(request(valid, { 'cf-connecting-ip': 'arbitrary-client-header' }));
    assert.equal(response.status, 200);
  }
  const database = openDatabase(filename);
  try {
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM pilot_request_rate_limits').get()?.count,
      0,
    );
  } finally {
    database.close();
  }
});
