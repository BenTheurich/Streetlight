import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedRoute } from '../../../lib/authenticated-route.ts';
import { geocodeChurch } from './route.ts';

test('geocoding rejects signed-out and malformed requests before calling Google', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return Response.json({
      status: 'OK',
      results: [
        { formatted_address: 'Test church', geometry: { location: { lat: 33, lng: -117 } } },
      ],
    });
  });
  const previousKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-only';
  const request = (body: unknown) =>
    new Request('http://localhost/api/geocode', { method: 'POST', body: JSON.stringify(body) });
  try {
    const signedOut = authenticatedRoute(geocodeChurch, async () => ({ user: null }));
    assert.equal((await signedOut(request({ address: 'Test church' }))).status, 401);
    for (const body of [null, {}, { address: '' }, { address: 'x'.repeat(301) }]) {
      assert.equal((await geocodeChurch(request(body))).status, 400);
    }
    assert.equal(calls, 0);
    assert.equal((await geocodeChurch(request({ address: 'Test church' }))).status, 200);
    assert.equal(calls, 1);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    else process.env.GOOGLE_MAPS_SERVER_API_KEY = previousKey;
  }
});
