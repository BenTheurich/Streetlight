import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMapCamera } from './map-camera.ts';

test('camera synchronization ignores reflected updates but accepts real movement', () => {
  const current = { center: [-117.11, 33.54] as [number, number], zoom: 16 };

  assert.equal(mergeMapCamera(current, { center: [-117.11, 33.54], zoom: 16 }), current);
  assert.deepEqual(mergeMapCamera(current, { center: [-117.12, 33.55], zoom: 17 }), {
    center: [-117.12, 33.55],
    zoom: 17,
  });
});

test('Google and MapLibre cameras use the same geographic scale', async () => {
  const camera = (await import('./map-camera.ts')) as unknown as {
    googleZoomToMapLibre: (zoom: number) => number;
    mapLibreZoomToGoogle: (zoom: number) => number;
  };

  assert.equal(typeof camera.googleZoomToMapLibre, 'function');
  assert.equal(typeof camera.mapLibreZoomToGoogle, 'function');
  assert.equal(camera.googleZoomToMapLibre(14), 13);
  assert.equal(camera.mapLibreZoomToGoogle(13.5), 14.5);
});
