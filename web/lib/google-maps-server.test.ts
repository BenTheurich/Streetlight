import assert from 'node:assert/strict';
import test from 'node:test';
import { geocodeAddress } from './google-maps-server.ts';

test('geocoding returns only the formatted address and longitude-latitude point', async () => {
  let requestedUrl = '';
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        status: 'OK',
        results: [
          {
            formatted_address: '31087 Nicolas Rd, Temecula, CA 92591, USA',
            geometry: { location: { lat: 33.54293, lng: -117.116885 } },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const result = await geocodeAddress('31087 Nicolas Rd', fetcher, 'server-test-key');

  assert.deepEqual(result, {
    formattedAddress: '31087 Nicolas Rd, Temecula, CA 92591, USA',
    center: [-117.116885, 33.54293],
  });
  const request = new URL(requestedUrl);
  assert.equal(
    request.origin + request.pathname,
    'https://maps.googleapis.com/maps/api/geocode/json',
  );
  assert.equal(request.searchParams.get('address'), '31087 Nicolas Rd');
  assert.equal(request.searchParams.get('key'), 'server-test-key');
});

test('geocoding rejects an address Google cannot resolve', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] }), { status: 200 });

  await assert.rejects(
    () => geocodeAddress('Missing address', fetcher, 'server-test-key'),
    /could not resolve/i,
  );
});

test('geocoding rejects missing server configuration before making a request', async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };

  await assert.rejects(() => geocodeAddress('31087 Nicolas Rd', fetcher, ''), /not configured/i);
  assert.equal(called, false);
});
