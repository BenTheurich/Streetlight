import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleSatelliteClient } from './google-satellite-tiles.ts';

test('satellite session starts lazily and is shared by tiles and viewport attribution', async () => {
  const urls: string[] = [];
  const client = createGoogleSatelliteClient(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('createSession')) {
      return Response.json({
        session: 'session-test',
        expiry: String(Math.floor(Date.now() / 1000) + 3_600),
        tileWidth: 256,
        tileHeight: 256,
        imageFormat: 'jpeg',
      });
    }
    if (url.includes('/viewport')) {
      return Response.json({ copyright: 'Map data ©2026 Google, Maxar Technologies' });
    }
    return new Response(Uint8Array.from([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=60' },
    });
  }, 'secret-server-key');

  assert.equal(urls.length, 0);
  const first = await client.loadTile(18, 45, 67);
  const second = await client.loadTile(18, 46, 67);
  const copyright = await client.loadCopyright({
    zoom: 18,
    north: 33.55,
    south: 33.53,
    east: -117.1,
    west: -117.13,
  });

  assert.equal(first.contentType, 'image/jpeg');
  assert.deepEqual([...first.bytes], [1, 2, 3]);
  assert.equal(first.cacheControl, 'private, max-age=60');
  assert.equal(second.bytes.length, 3);
  assert.equal(copyright, 'Map data ©2026 Google, Maxar Technologies');
  assert.equal(urls.filter((url) => url.includes('createSession')).length, 1);
  assert.match(urls[1], /\/v1\/2dtiles\/18\/45\/67/);
  assert.ok(urls.every((url) => url.includes('secret-server-key')));
});

test('satellite client validates requests before contacting Google', async () => {
  let called = false;
  const client = createGoogleSatelliteClient(async () => {
    called = true;
    return new Response();
  }, 'secret-server-key');

  await assert.rejects(() => client.loadTile(18, -1, 2), /invalid tile/i);
  await assert.rejects(() => client.loadTile(24, 1, 2), /invalid tile/i);
  await assert.rejects(
    () =>
      client.loadCopyright({
        zoom: 18,
        north: 33,
        south: 34,
        east: -117,
        west: -118,
      }),
    /invalid satellite viewport/i,
  );
  assert.equal(called, false);
});
