import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundaryStrokePaths,
  segmentMapAppearance,
  segmentStrokeWeight,
  segmentVisibleOnMap,
} from './territory-map-style.ts';

test('square boundary strokes restart on each side instead of crossing corners', () => {
  const ring = [
    [-2, -1],
    [2, -1],
    [2, 1],
    [-2, 1],
    [-2, -1],
  ] as [number, number][];

  assert.deepEqual(boundaryStrokePaths(ring, 'square'), [
    [
      [-2, -1],
      [2, -1],
    ],
    [
      [2, -1],
      [2, 1],
    ],
    [
      [2, 1],
      [-2, 1],
    ],
    [
      [-2, 1],
      [-2, -1],
    ],
  ]);
  assert.deepEqual(boundaryStrokePaths(ring, 'circle'), [ring]);
});

test('segment strokes scale from two to five pixels', () => {
  assert.equal(segmentStrokeWeight(10), 2);
  assert.equal(segmentStrokeWeight(12), 2);
  assert.equal(segmentStrokeWeight(13), 3);
  assert.equal(segmentStrokeWeight(14), 4);
  assert.equal(segmentStrokeWeight(17), 5);
});

test('segment map appearance makes only actionable roads selectable and emphasizes selection', () => {
  const active = {
    id: 'segment:one',
    roadGroupId: 'road:shared',
    active: true,
    eligible: true,
    manuallyExcluded: false,
  };
  assert.deepEqual(segmentMapAppearance(active, null, null), {
    strokeColor: '#df6d32',
    strokeOpacity: 0.65,
    weightOffset: 0,
    selectable: true,
    zIndex: 3,
  });
  assert.deepEqual(segmentMapAppearance(active, active.id, null), {
    strokeColor: '#9a421f',
    strokeOpacity: 0.95,
    weightOffset: 2,
    selectable: true,
    zIndex: 4,
  });
  assert.deepEqual(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: true }, null, null),
    {
      strokeColor: '#77736c',
      strokeOpacity: 0.5,
      weightOffset: 0,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.deepEqual(
    segmentMapAppearance(
      { ...active, active: false, eligible: false, manuallyExcluded: true },
      active.id,
      null,
    ),
    {
      strokeColor: '#3f3c37',
      strokeOpacity: 0.95,
      weightOffset: 2,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.equal(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: false }, null, null)
      .selectable,
    false,
  );
});

test('map visibility omits every segment outside the boundary before applying hidden-road controls', () => {
  const active = { active: true, withinBoundary: true, manuallyExcluded: false };
  assert.equal(segmentVisibleOnMap(active, false), true);
  assert.equal(segmentVisibleOnMap({ ...active, withinBoundary: false }, true), false);
  assert.equal(segmentVisibleOnMap({ ...active, active: false }, false), false);
  assert.equal(segmentVisibleOnMap({ ...active, active: false }, true), true);
  assert.equal(
    segmentVisibleOnMap({ active: false, withinBoundary: false, manuallyExcluded: true }, true),
    false,
  );
});
