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

test('map overlays republish after the basemap style is replaced', async () => {
  const module = (await import('./territory-map-style.ts')) as Record<string, unknown>;
  const keepPublished = module.keepMapOverlayPublished as
    | ((
        map: {
          on: (event: 'style.load', listener: () => void) => void;
          off: (event: 'style.load', listener: () => void) => void;
        },
        publish: () => void,
      ) => () => void)
    | undefined;
  assert.equal(typeof keepPublished, 'function');
  const listeners = new Set<() => void>();
  const map = {
    on(_event: 'style.load', listener: () => void) {
      listeners.add(listener);
    },
    off(_event: 'style.load', listener: () => void) {
      listeners.delete(listener);
    },
  };
  let publications = 0;
  const stop = keepPublished?.(map, () => {
    publications += 1;
  });

  assert.equal(publications, 1);
  for (const listener of listeners) listener();
  assert.equal(publications, 2);
  stop?.();
  for (const listener of listeners) listener();
  assert.equal(publications, 2);
});

test('map style listeners refresh overlays only after a replacement style loads', async () => {
  const module = (await import('./territory-map-style.ts')) as Record<string, unknown>;
  const listenForStyleLoad = module.listenForMapStyleLoad as
    | ((
        map: {
          on: (event: 'style.load', listener: () => void) => void;
          off: (event: 'style.load', listener: () => void) => void;
        },
        refresh: () => void,
      ) => () => void)
    | undefined;
  assert.equal(typeof listenForStyleLoad, 'function');
  const listeners = new Set<() => void>();
  const map = {
    on(_event: 'style.load', listener: () => void) {
      listeners.add(listener);
    },
    off(_event: 'style.load', listener: () => void) {
      listeners.delete(listener);
    },
  };
  let refreshes = 0;
  const stop = listenForStyleLoad?.(map, () => {
    refreshes += 1;
  });

  assert.equal(refreshes, 0);
  for (const listener of listeners) listener();
  assert.equal(refreshes, 1);
  stop?.();
  for (const listener of listeners) listener();
  assert.equal(refreshes, 1);
});

test('basemap road suppression keeps street-name symbols and Streetlight overlays', async () => {
  const module = (await import('./territory-map-style.ts')) as Record<string, unknown>;
  const roadGeometryLayerIds = module.basemapRoadGeometryLayerIds as
    | ((layers: Array<Record<string, unknown>>) => string[])
    | undefined;
  const layers = [
    {
      id: 'tunnel-road',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
    },
    {
      id: 'road-area',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'transportation',
    },
    {
      id: 'street-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
    },
    { id: 'streetlight-road', type: 'line', source: 'streetlightCoverage' },
  ];

  assert.equal(typeof roadGeometryLayerIds, 'function');
  assert.deepEqual(roadGeometryLayerIds?.(layers), ['tunnel-road', 'road-area']);
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
  }
  assert.match(church, /M20\.8 11\.5h2\.4v4\.7H27v2\.4h-3\.8v7\.9h-2\.4v-7\.9H17v-2\.4h3\.8Z/);
  assert.doesNotMatch(church, /<circle/);
  assert.match(start, /<circle cx="22" cy="17\.5" r="4\.6" fill="#ffffff"/);
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

test('segment map appearance preserves status styling beneath selection', () => {
  const active = {
    id: 'segment:one',
    roadGroupId: 'road:shared',
    active: true,
    eligible: true,
    manuallyExcluded: false,
  };
  assert.deepEqual(segmentMapAppearance(active, false), {
    strokeColor: '#596675',
    strokeOpacity: 0.8,
    weightOffset: 0,
    selected: false,
    selectable: true,
    zIndex: 3,
  });
  assert.deepEqual(segmentMapAppearance(active, true), {
    strokeColor: '#596675',
    strokeOpacity: 0.95,
    weightOffset: 0,
    selected: true,
    selectable: true,
    zIndex: 4,
  });
  assert.deepEqual(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: true }, false),
    {
      strokeColor: '#aaa7a0',
      strokeOpacity: 0.45,
      weightOffset: -1,
      selected: false,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.deepEqual(
    segmentMapAppearance(
      { ...active, active: false, eligible: false, manuallyExcluded: true },
      true,
    ),
    {
      strokeColor: '#aaa7a0',
      strokeOpacity: 0.75,
      weightOffset: -1,
      selected: true,
      selectable: true,
      zIndex: 5,
    },
  );
  assert.deepEqual(segmentMapAppearance({ ...active, active: false, eligible: false }, false), {
    strokeColor: '#6f8794',
    strokeOpacity: 0.48,
    weightOffset: -1,
    selected: false,
    selectable: true,
    zIndex: 1,
  });
  assert.equal(
    segmentMapAppearance({ ...active, eligible: false, manuallyExcluded: false }, false).selectable,
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
