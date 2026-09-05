import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coverageSelectionCameraOptions,
  forwardMapCameraChange,
  googleZoomToMapLibre,
  isReflectedMapCamera,
  mapLibreZoomToGoogle,
  mapReadyCameraTarget,
  mergeMapCamera,
  positionBounds,
  segmentSelectionBounds,
} from './map-camera.ts';

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

test('map readiness preserves its entrance fit unless the controlled camera changed while loading', () => {
  const createdWith = { center: [-117.11, 33.54] as [number, number], zoom: 11 };
  const changed = { center: [-117.12, 33.55] as [number, number], zoom: 12 };

  assert.equal(mapReadyCameraTarget(createdWith, { ...createdWith }), null);
  assert.equal(mapReadyCameraTarget(createdWith, changed), changed);
  assert.equal(mapReadyCameraTarget(null, changed), changed);
});

test('Google and MapLibre cameras use the same geographic scale', () => {
  assert.equal(googleZoomToMapLibre(14), 13);
  assert.equal(mapLibreZoomToGoogle(13.5), 14.5);
});

test('map fitting derives one bound from every visible position', () => {
  assert.deepEqual(
    positionBounds([
      [-117.12, 33.55],
      [-117.1, 33.52],
      [-117.11, 33.54],
    ]),
    [
      [-117.12, 33.52],
      [-117.1, 33.55],
    ],
  );
  assert.equal(positionBounds([]), null);
});

test('segment selection bounds include only the requested road geometry', () => {
  const segments = [
    {
      id: 'selected',
      geometry: {
        coordinates: [
          [-117.12, 33.52],
          [-117.1, 33.54],
        ] as Array<[number, number]>,
      },
    },
    {
      id: 'unrelated',
      geometry: {
        coordinates: [
          [-118, 34],
          [-118.2, 34.2],
        ] as Array<[number, number]>,
      },
    },
  ];

  assert.deepEqual(segmentSelectionBounds(segments, ['selected']), [
    [-117.12, 33.52],
    [-117.1, 33.54],
  ]);
  assert.equal(segmentSelectionBounds(segments, ['missing']), null);
});

test('coverage camera fitting follows both map and search selections and respects reduced motion', () => {
  assert.equal(coverageSelectionCameraOptions('map', false)?.duration, 220);
  assert.deepEqual(coverageSelectionCameraOptions('search', true), {
    padding: { top: 64, right: 96, bottom: 64, left: 64 },
    maxZoom: 16,
    duration: 0,
  });
  assert.equal(coverageSelectionCameraOptions('search', false)?.duration, 220);
});
