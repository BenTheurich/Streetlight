import assert from 'node:assert/strict';
import test from 'node:test';
import * as territoryMapStyle from './territory-map-style.ts';
import { segmentStrokeWeight } from './territory-map-style.ts';

test('segment strokes scale from two to five pixels', () => {
  assert.equal(segmentStrokeWeight(10), 2);
  assert.equal(segmentStrokeWeight(12), 2);
  assert.equal(segmentStrokeWeight(13), 3);
  assert.equal(segmentStrokeWeight(14), 4);
  assert.equal(segmentStrokeWeight(17), 5);
});

test('segment map appearance makes only actionable roads selectable and emphasizes selection', () => {
  const appearance = (
    territoryMapStyle as typeof territoryMapStyle & {
      segmentMapAppearance?: (
        segment: {
          id: string;
          roadGroupId: string;
          active: boolean;
          eligible: boolean;
          manuallyExcluded: boolean;
        },
        selectedSegmentId: string | null,
        selectedHiddenRoadGroupId: string | null,
      ) => {
        strokeColor: string;
        strokeOpacity: number;
        weightOffset: number;
        selectable: boolean;
        zIndex: number;
      };
    }
  ).segmentMapAppearance;
  assert.equal(typeof appearance, 'function');
  assert.ok(appearance);

  const active = {
    id: 'segment:one',
    roadGroupId: 'road:shared',
    active: true,
    eligible: true,
    manuallyExcluded: false,
  };
  assert.deepEqual(appearance(active, null, null), {
    strokeColor: '#df6d32',
    strokeOpacity: 0.65,
    weightOffset: 0,
    selectable: true,
    zIndex: 3,
  });
  assert.deepEqual(appearance(active, active.id, null), {
    strokeColor: '#9a421f',
    strokeOpacity: 0.95,
    weightOffset: 2,
    selectable: true,
    zIndex: 4,
  });
  assert.deepEqual(appearance({ ...active, eligible: false, manuallyExcluded: true }, null, null), {
    strokeColor: '#77736c',
    strokeOpacity: 0.5,
    weightOffset: 0,
    selectable: true,
    zIndex: 5,
  });
  assert.deepEqual(
    appearance(
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
    appearance({ ...active, eligible: false, manuallyExcluded: false }, null, null).selectable,
    false,
  );
});

test('map visibility omits every segment outside the boundary before applying hidden-road controls', () => {
  const visible = (
    territoryMapStyle as typeof territoryMapStyle & {
      segmentVisibleOnMap?: (
        segment: {
          active: boolean;
          withinBoundary: boolean;
          manuallyExcluded: boolean;
        },
        showHiddenRoads: boolean,
      ) => boolean;
    }
  ).segmentVisibleOnMap;
  assert.equal(typeof visible, 'function');
  assert.ok(visible);

  const active = { active: true, withinBoundary: true, manuallyExcluded: false };
  assert.equal(visible(active, false), true);
  assert.equal(visible({ ...active, withinBoundary: false }, true), false);
  assert.equal(visible({ ...active, active: false }, false), false);
  assert.equal(visible({ ...active, active: false }, true), true);
  assert.equal(
    visible({ active: false, withinBoundary: false, manuallyExcluded: true }, true),
    false,
  );
});
