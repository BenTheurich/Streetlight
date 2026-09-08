import assert from 'node:assert/strict';

const origin = new URL(process.argv[2]);
assert.ok(
  origin.protocol === 'https:' ||
    (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)),
  'Use the deployed HTTPS URL or an explicit localhost test URL',
);
const response = await fetch(new URL('/api/health', origin), {
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
assert.equal(response.status, 200, `Health returned ${response.status}`);
assert.deepEqual(await response.json(), { status: 'ok' });
console.log(`Streetlight health passed: ${origin.origin}`);
