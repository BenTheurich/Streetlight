import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardMapCameraChange, isReflectedMapCamera, mergeMapCamera } from './map-camera.ts';

test('camera synchronization ignores reflected updates but accepts real movement', () => {
  const current = { center: [-117.11, 33.54] as [number, number], zoom: 16 };

  assert.equal(mergeMapCamera(current, { center: [-117.11, 33.54], zoom: 16 }), current);
  assert.deepEqual(mergeMapCamera(current, { center: [-117.12, 33.55], zoom: 17 }), {
    center: [-117.12, 33.55],
    zoom: 17,
  });
});

test('controlled map events publish real movement but not reflected movement', () => {
  const current = { center: [-117.11, 33.54] as [number, number], zoom: 16 };
  const published: Array<{ center: [number, number]; zoom: number }> = [];

  assert.equal(
    forwardMapCameraChange(current, { center: [-117.11, 33.54], zoom: 16 }, (next) =>
      published.push(next),
    ),
    current,
  );
  assert.equal(published.length, 0);
  assert.deepEqual(
    forwardMapCameraChange(current, { center: [-117.12, 33.55], zoom: 17 }, (next) =>
      published.push(next),
    ),
    { center: [-117.12, 33.55], zoom: 17 },
  );
  assert.deepEqual(published, [{ center: [-117.12, 33.55], zoom: 17 }]);
});

test('a camera update emitted by the map is recognized after the map keeps moving', () => {
  const published = { center: [-117.11, 33.54] as [number, number], zoom: 16 };

  assert.equal(isReflectedMapCamera(published, published), true);
  assert.equal(isReflectedMapCamera(null, published), false);
  assert.equal(isReflectedMapCamera(published, { center: [-117.12, 33.55], zoom: 17 }), false);
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

test('map fitting derives one bound from every visible position', async () => {
  const camera = (await import('./map-camera.ts')) as unknown as {
    positionBounds?: (
      positions: Array<[number, number]>,
    ) => [[number, number], [number, number]] | null;
  };

  assert.equal(typeof camera.positionBounds, 'function');
  assert.deepEqual(
    camera.positionBounds?.([
      [-117.12, 33.55],
      [-117.1, 33.52],
      [-117.11, 33.54],
    ]),
    [
      [-117.12, 33.52],
      [-117.1, 33.55],
    ],
  );
  assert.equal(camera.positionBounds?.([]), null);
});

test('a recoverable MapLibre error after load does not replace the ready map', async () => {
  const camera = (await import('./map-camera.ts')) as unknown as {
    mapLoadErrorIsFatal?: (loaded: boolean) => boolean;
  };

  assert.equal(camera.mapLoadErrorIsFatal?.(false), true);
  assert.equal(camera.mapLoadErrorIsFatal?.(true), false);
});
