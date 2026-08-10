import assert from 'node:assert/strict';
import test from 'node:test';
import * as cameraModule from './map-camera.ts';
import {
  forwardMapCameraChange,
  isReflectedMapCamera,
  mergeMapCamera,
  workspaceMapTransition,
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

test('refreshed map data restyles the existing map instead of recreating it', () => {
  assert.equal(workspaceMapTransition(true, true, true, false), 'restyle');
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

test('segment selection bounds include only the requested road geometry', async () => {
  const camera = (await import('./map-camera.ts')) as unknown as {
    segmentSelectionBounds?: (
      segments: Array<{
        id: string;
        geometry: { coordinates: Array<[number, number]> };
      }>,
      ids: string[],
    ) => [[number, number], [number, number]] | null;
  };
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

  assert.equal(typeof camera.segmentSelectionBounds, 'function');
  assert.deepEqual(camera.segmentSelectionBounds?.(segments, ['selected']), [
    [-117.12, 33.52],
    [-117.1, 33.54],
  ]);
  assert.equal(camera.segmentSelectionBounds?.(segments, ['missing']), null);
});

test('coverage camera fitting follows both map and search selections and respects reduced motion', () => {
  const options = cameraModule.coverageSelectionCameraOptions;
  assert.equal(typeof options, 'function');
  assert.equal(options?.('map', false)?.duration, 220);
  assert.deepEqual(options?.('search', true), {
    padding: { top: 64, right: 96, bottom: 64, left: 64 },
    maxZoom: 16,
    duration: 0,
  });
  assert.equal(options?.('search', false)?.duration, 220);
});

test('a recoverable MapLibre error after load does not replace the ready map', async () => {
  const camera = (await import('./map-camera.ts')) as unknown as {
    mapLoadErrorIsFatal?: (loaded: boolean) => boolean;
  };

  assert.equal(camera.mapLoadErrorIsFatal?.(false), true);
  assert.equal(camera.mapLoadErrorIsFatal?.(true), false);
});
