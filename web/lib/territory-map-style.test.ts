import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apartmentMarkerColor,
  boundaryStrokePaths,
  segmentMapAppearance,
  segmentStrokeWeight,
  segmentVisibleOnMap,
} from './territory-map-style.ts';

test('apartment markers stay blue across review states', () => {
  assert.equal(apartmentMarkerColor('needs_review'), '#123464');
  assert.equal(apartmentMarkerColor('ready'), '#123464');
  assert.equal(apartmentMarkerColor('deferred'), '#123464');
});

test('church, packet, and apartment markers share one visual system', async () => {
  const module = (await import('./territory-map-style.ts')) as Record<string, unknown>;
  const markerStyle = module.mapMarkerStyle as Record<string, unknown> | undefined;
  const pinDataUrl = module.mapPinDataUrl as ((symbol: 'church' | 'start') => string) | undefined;

  assert.deepEqual(markerStyle, {
    fill: '#123464',
    outline: '#ffffff',
    outlineWidth: 2,
    radius: 12,
    selectedRadius: 15,
  });
  assert.equal(typeof pinDataUrl, 'function');
  const church = decodeURIComponent(pinDataUrl?.('church') ?? '');
  const start = decodeURIComponent(pinDataUrl?.('start') ?? '');
  for (const pin of [church, start]) {
    assert.match(pin, /fill="#123464"/);
    assert.match(pin, /stroke="#ffffff"/);
    assert.match(pin, /<circle cx="22" cy="17\.5" r="4\.6" fill="#ffffff"/);
  }
  assert.match(church, /stroke="#123464"/);
  assert.doesNotMatch(start, /stroke="#123464"/);
});

test('apartment interaction keeps selection origin, camera threshold, and drawing isolation explicit', async () => {
  const module = (await import('./territory-map-style.ts')) as Record<string, unknown>;
  const optionLabel = module.apartmentOptionLabel as
    | ((apartment: {
        address: string | null;
        reviewStatus: 'needs_review' | 'ready' | 'deferred';
        estimatedTracts: number;
      }) => string)
    | undefined;
  const focusZoom = module.apartmentFocusZoom as
    | ((source: 'map' | 'selector', zoom: number) => number | null)
    | undefined;
  const createSelection = module.createApartmentSelection as
    | ((id: string, source: 'map' | 'selector') => { id: string; source: 'map' | 'selector' })
    | undefined;
  const apartmentAllowsDrawingPoint = module.apartmentAllowsDrawingPoint as
    | ((apartmentHit: boolean) => boolean)
    | undefined;
  const expandCluster = module.expandApartmentCluster as
    | ((
        source: { getClusterExpansionZoom: (id: number) => Promise<number> },
        id: number,
        center: [number, number],
        move: (camera: { center: [number, number]; zoom: number }) => void,
      ) => Promise<void>)
    | undefined;

  assert.equal(typeof optionLabel, 'function');
  assert.equal(
    optionLabel?.({ address: null, reviewStatus: 'needs_review', estimatedTracts: 18 }),
    'Address unavailable · Needs review · 18 estimated tracts',
  );
  assert.equal(
    optionLabel?.({ address: '1 Main Street', reviewStatus: 'ready', estimatedTracts: 1 }),
    '1 Main Street · Ready · 1 estimated tract',
  );
  assert.equal(focusZoom?.('map', 11), null);
  assert.equal(focusZoom?.('selector', 11), 16);
  assert.equal(focusZoom?.('selector', 17.25), 17.25);
  assert.equal(typeof createSelection, 'function');
  assert.deepEqual(createSelection?.('apartment-one', 'map'), {
    id: 'apartment-one',
    source: 'map',
  });
  assert.deepEqual(createSelection?.('apartment-one', 'selector'), {
    id: 'apartment-one',
    source: 'selector',
  });
  assert.equal(typeof apartmentAllowsDrawingPoint, 'function');
  assert.equal(apartmentAllowsDrawingPoint?.(false), true);
  assert.equal(apartmentAllowsDrawingPoint?.(true), false);

  assert.equal(typeof expandCluster, 'function');
  let requestedId = 0;
  let camera: { center: [number, number]; zoom: number } | null = null;
  await expandCluster?.(
    {
      getClusterExpansionZoom: async (id) => {
        requestedId = id;
        return 14.5;
      },
    },
    27,
    [-117.1, 33.5],
    (next) => {
      camera = next;
    },
  );
  assert.equal(requestedId, 27);
  assert.deepEqual(camera, { center: [-117.1, 33.5], zoom: 14.5 });
});

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
