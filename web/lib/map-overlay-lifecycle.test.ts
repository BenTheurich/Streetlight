import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoverageWorkspace } from './coverage.ts';
import {
  createMapOverlayLifecycle,
  type MapOverlayAdapter,
  type MapOverlayEvent,
  type MapOverlayLayer,
  type MapOverlayMarker,
  type WorkspaceMapBasePresentation,
  type WorkspaceMapPresentation,
} from './map-overlay-lifecycle.ts';
import type { OpenMapData } from './open-map-data.ts';
import type { PacketProposal } from './packet-selection.ts';
import { projectReconciliation, type ReconciliationBatch } from './reconciliation.ts';

const emptyData: OpenMapData = {
  churchId: 'church-one',
  territoryId: 'territory-one',
  territoryName: 'Test territory',
  center: [-117.1, 33.5] as [number, number],
  bounds: [-117.2, 33.4, -117, 33.6] as [number, number, number, number],
  boundary: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-117.2, 33.4],
        [-117, 33.4],
        [-117, 33.6],
        [-117.2, 33.6],
        [-117.2, 33.4],
      ],
    ],
  },
  importGeneration: 1,
  overtureRelease: 'test',
  buildingMode: 'overture_only' as const,
  segments: [],
  apartmentComplexes: [],
  buildings: [],
  houseNumbers: [],
  attribution: { base: 'Base', roads: 'Roads', buildings: 'Buildings', fema: null },
};

function base(mapType: 'roadmap' | 'satellite' = 'roadmap'): WorkspaceMapBasePresentation {
  return { kind: 'base', data: emptyData, mapType };
}

function selectedReconciliationPresentation() {
  const batch: ReconciliationBatch = {
    id: 'batch-style-replacement',
    name: 'Style replacement batch',
    status: 'finalized',
    finalizedAt: '2026-01-01T00:00:00Z',
    packets: [
      {
        id: 'packet-style-replacement',
        code: 'A1',
        kind: 'street',
        status: 'active',
        estimatedTracts: 10,
        start: { address: '1 Main Street', position: [-117.1, 33.5] },
        segments: [
          {
            id: 'segment-style-replacement',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-117.1, 33.5],
                [-117.09, 33.5],
              ],
            },
            estimatedHomes: 10,
          },
        ],
        apartment: null,
        completedOn: null,
        history: [],
      },
    ],
    counts: { active: 1, completed: 0, cancelled: 0 },
  };
  return projectReconciliation(
    { asOf: '2026-01-01', defaultBatchId: batch.id, batches: [batch] },
    {
      batchId: batch.id,
      outcomes: new Map([[batch.packets[0].id, 'still-here']]),
      selectedPacketId: batch.packets[0].id,
      view: 'active',
    },
  ).map;
}

class TestMapAdapter implements MapOverlayAdapter {
  readonly initialBase: WorkspaceMapBasePresentation;
  readonly sources = new Map<string, unknown>();
  readonly sourceUpdates: Array<{ id: string; data: unknown }> = [];
  readonly sourceOptions = new Map<string, Record<string, unknown> | undefined>();
  readonly layers = new Map<string, MapOverlayLayer>();
  readonly listeners = new Map<string, Set<(event: MapOverlayEvent) => void>>();
  readonly markers = new Map<string, MapOverlayMarker>();
  readonly paintProperties = new Map<string, unknown>();
  readonly visibilityUpdates: Array<{ id: string; visible: boolean }> = [];
  readonly fits: Array<{ bounds: unknown; options: unknown }> = [];
  readonly eases: Array<{ center?: [number, number]; zoom?: number }> = [];
  resizes = 0;
  renderedLayers: MapOverlayAdapter['styleLayers'] extends () => infer Result ? Result : never = [];
  boxSelection: ((ids: string[], additive: boolean) => void) | null = null;
  emptyMapClick: (() => void) | null = null;
  clusterZoom: Promise<number> = Promise.resolve(14);
  readonly styleRequests: Array<{
    complete: () => void;
    reject: (error: Error) => void;
  }> = [];
  readonly styleTargets: WorkspaceMapBasePresentation[] = [];
  readonly progressMasks: Array<{
    visible: boolean;
    lines: Array<Array<[number, number]>>;
    active?: { lines: Array<Array<[number, number]>>; opacity: number };
  }> = [];
  styleReplacements = 0;
  ready = Promise.resolve();

  constructor(initialBase = base()) {
    this.initialBase = initialBase;
  }

  waitUntilReady() {
    return this.ready;
  }

  replaceStyle(value: WorkspaceMapBasePresentation) {
    this.styleReplacements += 1;
    this.styleTargets.push(value);
    this.sources.clear();
    this.layers.clear();
    return new Promise<void>((resolve, reject) => {
      this.styleRequests.push({ complete: resolve, reject });
    });
  }

  hasSource(id: string) {
    return this.sources.has(id);
  }

  addSource(id: string, data: unknown, options?: Record<string, unknown>) {
    assert.equal(this.sources.has(id), false);
    this.sources.set(id, data);
    this.sourceOptions.set(id, options);
  }

  setSourceData(id: string, data: unknown) {
    assert.equal(this.sources.has(id), true);
    this.sources.set(id, data);
    this.sourceUpdates.push({ id, data });
  }

  removeSource(id: string) {
    this.sources.delete(id);
  }

  hasLayer(id: string) {
    return this.layers.has(id);
  }

  addLayer(layer: MapOverlayLayer) {
    assert.equal(this.layers.has(layer.id), false);
    this.layers.set(layer.id, layer);
  }

  removeLayer(id: string) {
    this.layers.delete(id);
  }

  setLayerVisibility(id: string, visible: boolean) {
    const layer = this.layers.get(id);
    assert(layer);
    this.layers.set(id, { ...layer, visible });
    this.visibilityUpdates.push({ id, visible });
  }

  setPaintProperty(id: string, property: string, value: unknown) {
    this.paintProperties.set(`${id}:${property}`, value);
  }

  setProgressMask(mask: {
    visible: boolean;
    lines: Array<Array<[number, number]>>;
    active?: { lines: Array<Array<[number, number]>>; opacity: number };
  }) {
    this.progressMasks.push(mask);
  }

  styleLayers() {
    return this.renderedLayers;
  }

  onLayer(event: string, layerId: string, listener: (event: MapOverlayEvent) => void) {
    const key = `${event}:${layerId}`;
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => listeners.delete(listener);
  }

  setCursor() {}
  resize() {
    this.resizes += 1;
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fits.push({ bounds, options });
  }
  easeTo(camera: { center?: [number, number]; zoom?: number }) {
    this.eases.push(camera);
  }
  getZoom() {
    return 11;
  }
  getClusterExpansionZoom() {
    return this.clusterZoom;
  }
  registerBoxSelection(options: Parameters<MapOverlayAdapter['registerBoxSelection']>[0]) {
    this.boxSelection = options.onComplete;
    this.emptyMapClick = options.onEmptyClick;
    return () => {
      this.boxSelection = null;
      this.emptyMapClick = null;
    };
  }

  addMarker(marker: MapOverlayMarker) {
    this.markers.set(marker.key, marker);
    return () => this.markers.delete(marker.key);
  }

  dispose() {
    this.listeners.clear();
    this.markers.clear();
  }

  emit(event: string, layerId: string, value: MapOverlayEvent) {
    for (const listener of this.listeners.get(`${event}:${layerId}`) ?? []) listener(value);
  }
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('publishes, updates, hides, and cleans one coverage overlay without duplication', async () => {
  const statuses: string[] = [];
  const lifecycle = createMapOverlayLifecycle({ onStatus: ({ state }) => statuses.push(state) });
  const adapter = new TestMapAdapter();
  const detach = lifecycle.attach(adapter);
  const selected: string[] = [];
  const first = lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: true,
    segments: [
      {
        id: 'segment-one',
        roadGroupId: 'road-one',
        streetName: 'Main Street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-117.1, 33.5],
            [-117.09, 33.5],
          ],
        },
        estimatedHomes: 10,
        eligible: true,
        excludedReason: null,
        lastCoveredOn: null,
        coverageClass: 'red',
        roots: [],
      },
    ],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: false,
    fitOnFirstShow: true,
    onSelectSegment: (id) => selected.push(id),
  });
  await turn();

  assert.deepEqual(statuses, ['loading', 'ready']);
  assert.equal(adapter.sources.size, 2);
  assert.equal(adapter.layers.size, 7);
  assert.deepEqual(adapter.sourceOptions.get('streetlightApartments'), {
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 16,
  });
  assert.deepEqual(adapter.layers.get('streetlight-coverage')?.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    2,
    14,
    5,
  ]);
  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size, 1);

  const second = lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: false,
    segments: [],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: true,
    fitOnFirstShow: true,
    onSelectSegment: (id) => selected.push(id),
  });
  await turn();

  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size ?? 0, 0);
  assert.equal(adapter.layers.get('streetlight-coverage')?.visible, true);
  assert.equal(adapter.layers.get('streetlight-apartments')?.visible, true);
  second();
  assert.equal(adapter.layers.get('streetlight-coverage')?.visible, false);
  assert.equal(adapter.layers.get('streetlight-apartments')?.visible, false);
  assert.equal(adapter.listeners.get('click:streetlight-apartment-clusters')?.size ?? 0, 0);
  assert.equal(adapter.markers.size, 0);
  first();
  detach();
  lifecycle.dispose();
  assert.equal(adapter.listeners.size, 0);
  assert.equal(adapter.markers.size, 0);
});

test('presentation and adapter cleanup permit React-style ownership replay', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const firstAdapter = new TestMapAdapter();
  const releaseFirstBase = lifecycle.present(base());
  const detachFirst = lifecycle.attach(firstAdapter);
  await turn();

  releaseFirstBase();
  detachFirst();
  assert.equal(firstAdapter.sources.size, 0);
  assert.equal(firstAdapter.layers.size, 0);
  assert.equal(firstAdapter.listeners.size, 0);
  assert.equal(firstAdapter.markers.size, 0);

  const secondAdapter = new TestMapAdapter();
  const releaseSecondBase = lifecycle.present(base());
  const detachSecond = lifecycle.attach(secondAdapter);
  await turn();

  assert.equal(secondAdapter.sources.has('streetlightBoundary'), true);
  detachSecond();
  releaseSecondBase();
  lifecycle.dispose();
});

test('a same-style base updates current boundary and church data without replacing style', async () => {
  const statuses: string[] = [];
  const initial = base();
  const updated: WorkspaceMapBasePresentation = {
    ...initial,
    data: {
      ...initial.data,
      center: [-117.3, 33.7],
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [-117.4, 33.6],
            [-117.2, 33.6],
            [-117.2, 33.8],
            [-117.4, 33.8],
            [-117.4, 33.6],
          ],
        ],
      },
    },
  };
  const lifecycle = createMapOverlayLifecycle({ onStatus: ({ state }) => statuses.push(state) });
  const adapter = new TestMapAdapter(initial);
  lifecycle.present(initial);
  lifecycle.attach(adapter);
  await turn();

  lifecycle.present(updated);
  await turn();

  assert.equal(adapter.styleReplacements, 0);
  assert.deepEqual(
    (adapter.sources.get('streetlightBoundary') as { geometry: unknown }).geometry,
    updated.data.boundary,
  );
  assert.deepEqual(adapter.markers.get('church')?.position, updated.data.center);
  assert.deepEqual(statuses, ['loading', 'ready']);
  lifecycle.dispose();
});

test('an identical provider style received before initial readiness cannot leave loading', async () => {
  let resolveReady = () => {};
  const initial = base();
  const statuses: string[] = [];
  const lifecycle = createMapOverlayLifecycle({
    onStatus: ({ state }) => statuses.push(state),
  });
  const adapter = new TestMapAdapter(initial);
  adapter.ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  lifecycle.present(initial);
  lifecycle.attach(adapter);
  lifecycle.present({ ...initial, data: { ...initial.data } });

  resolveReady();
  await turn();

  assert.equal(adapter.styleReplacements, 0);
  assert.deepEqual(statuses, ['loading', 'ready']);
  lifecycle.dispose();
});

test('serializes style replacement, applies only the latest base, and republishes once', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  let selections = 0;
  lifecycle.present(base());
  lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: true,
    segments: [
      {
        id: 'segment-one',
        roadGroupId: 'road-one',
        streetName: 'Main Street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-117.1, 33.5],
            [-117.09, 33.5],
          ],
        },
        estimatedHomes: 10,
        eligible: true,
        excludedReason: null,
        lastCoveredOn: null,
        coverageClass: 'red',
        roots: [],
      },
    ],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: false,
    fitOnFirstShow: false,
    onSelectSegment: () => {
      selections += 1;
    },
  });
  lifecycle.present({
    kind: 'reconciliation',
    visible: true,
    presentation: selectedReconciliationPresentation(),
  });
  lifecycle.attach(adapter);
  await turn();
  assert.equal(adapter.sources.has('streetlightCoverage'), true);
  assert.equal(adapter.sources.has('streetlight-reconciliation'), true);
  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size, 1);

  lifecycle.present(base('satellite'));
  lifecycle.present({ ...base('roadmap'), data: { ...emptyData, importGeneration: 2 } });
  await turn();
  assert.equal(adapter.styleReplacements, 1);
  assert.equal(adapter.styleTargets[0]?.mapType, 'satellite');
  assert.equal(adapter.sources.size, 0);
  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size ?? 0, 0);

  adapter.styleRequests[0]?.complete();
  await turn();
  assert.equal(adapter.styleReplacements, 2);
  assert.equal(adapter.styleTargets[1]?.mapType, 'roadmap');
  assert.equal(adapter.styleTargets[1]?.data.importGeneration, 2);
  assert.equal(adapter.sources.size, 0);
  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size ?? 0, 0);

  adapter.styleRequests[1]?.complete();
  await turn();
  assert.equal(adapter.styleReplacements, 2);
  assert.equal(adapter.sources.has('streetlightCoverage'), true);
  const reconciliation = adapter.sources.get('streetlight-reconciliation') as {
    features: Array<{ properties: { selected: boolean } }>;
  };
  assert.equal(reconciliation.features[0]?.properties.selected, true);
  assert.equal(adapter.layers.get('streetlight-reconciliation-line')?.visible, true);
  assert.equal(adapter.markers.has('reconciliation-start:packet-style-replacement'), true);
  assert.equal(adapter.listeners.get('click:streetlight-coverage')?.size, 1);
  adapter.emit('click', 'streetlight-coverage', {
    features: [{ geometry: { type: 'LineString' }, properties: { id: 'segment-one' } }],
  });
  assert.equal(selections, 1);
  lifecycle.dispose();
});

test('territory intent owns road suppression, direct selection, and box selection cleanup', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  adapter.layers.set('base-road', {
    id: 'base-road',
    type: 'line',
    source: 'openmaptiles',
  });
  adapter.renderedLayers = [
    {
      id: 'base-road',
      type: 'line',
      source: 'openmaptiles',
      sourceLayer: 'transportation',
    },
  ];
  const selected: Array<{ ids: string[]; additive: boolean }> = [];
  const releaseCoverage = lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: false,
    segments: [],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: false,
    fitOnFirstShow: false,
    onSelectSegment() {},
  });
  const territory: Extract<WorkspaceMapPresentation, { kind: 'territory' }> = {
    kind: 'territory',
    visible: true,
    interactive: true,
    center: [-117.1, 33.5],
    radiusMiles: 2,
    boundaryShape: 'circle',
    segments: [
      {
        id: 'segment-one',
        sourceSegmentId: 'source-one',
        roadGroupId: 'road-one',
        roadClass: 'residential',
        streetName: 'Main Street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-117.1, 33.5],
            [-117.09, 33.5],
          ],
        },
        estimatedHomes: 10,
        activationKind: 'automatic',
        active: true,
        withinBoundary: true,
        manuallyExcluded: false,
        eligible: true,
        excludedReason: null,
      },
    ],
    apartments: [],
    mutationLocked: false,
    selectedSegmentIds: [],
    roadFocusRequest: null,
    showHiddenRoads: false,
    boxSelectionArmed: true,
    onBoxSelectionComplete() {},
    onSelectSegments: (ids, additive) => selected.push({ ids, additive }),
    onSelectApartment() {},
    groupingMemberIds: null,
    onToggleApartmentMember() {},
    selectedApartmentId: null,
    selectedApartmentPosition: null,
    apartmentSelectionSource: null,
  };
  let cleanup = lifecycle.present(territory);
  lifecycle.attach(adapter);
  await turn();

  assert.equal(adapter.layers.get('base-road')?.visible, false);
  const territoryBoundaryFill = adapter.sources.get('territory-boundary-fill') as {
    geometry: unknown;
  };
  const territoryBoundaryLine = adapter.sources.get('territory-boundary-line') as {
    geometry: unknown;
  };
  assert.deepEqual(territoryBoundaryLine.geometry, territoryBoundaryFill.geometry);
  adapter.sourceUpdates.length = 0;
  adapter.visibilityUpdates.length = 0;
  const previousCleanup = cleanup;
  cleanup = lifecycle.present({ ...territory, showHiddenRoads: true });
  previousCleanup();
  assert.equal(
    adapter.sourceUpdates.filter(({ id }) => id === 'territory-boundary-fill').length,
    1,
  );
  assert.equal(
    adapter.sourceUpdates.filter(({ id }) => id === 'territory-boundary-line').length,
    1,
  );
  assert.equal(
    adapter.visibilityUpdates.some(
      ({ id, visible }) => id.startsWith('territory-boundary-') && !visible,
    ),
    false,
  );
  const territoryWidth = [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['max', 1, ['+', 2, ['get', 'weightOffset']]],
    14,
    ['max', 1, ['+', 5, ['get', 'weightOffset']]],
  ];
  assert.deepEqual(adapter.paintProperties.get('streetlight-coverage:line-width'), territoryWidth);
  assert.deepEqual(
    adapter.paintProperties.get('streetlight-territory-hidden:line-width'),
    territoryWidth,
  );
  adapter.emit('click', 'streetlight-coverage', {
    features: [
      {
        geometry: { type: 'LineString' },
        properties: { id: 'segment-one', selectable: true },
      },
    ],
  });
  adapter.emit('click', 'streetlight-territory-hidden', {
    shiftKey: true,
    features: [
      {
        geometry: { type: 'LineString' },
        properties: { id: 'segment-two', selectable: true },
      },
    ],
  });
  adapter.boxSelection?.(['segment-two'], true);
  assert.deepEqual(selected, [
    { ids: ['segment-one'], additive: false },
    { ids: ['segment-two'], additive: true },
  ]);
  adapter.emptyMapClick?.();
  assert.equal(selected.length, 2);

  const hiddenCleanup = cleanup;
  cleanup = lifecycle.present({ ...territory, selectedSegmentIds: ['segment-one'] });
  hiddenCleanup();
  adapter.emptyMapClick?.();
  assert.deepEqual(selected.at(-1), { ids: [], additive: false });

  cleanup();
  assert.equal(adapter.layers.get('base-road')?.visible, true);
  assert.equal(adapter.layers.get('streetlight-coverage')?.visible, true);
  assert.equal(adapter.layers.get('streetlight-apartments')?.visible, false);
  assert.equal(adapter.layers.get('territory-boundary-fill')?.visible, false);
  assert.equal(adapter.layers.get('territory-boundary-line')?.visible, false);
  assert.equal(adapter.layers.get('streetlight-apartment-selection-fill')?.visible, false);
  assert.equal(adapter.layers.get('streetlight-apartment-selection-line')?.visible, false);
  assert.deepEqual(adapter.paintProperties.get('streetlight-coverage:line-width'), [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    2,
    14,
    5,
  ]);
  assert.deepEqual(adapter.sources.get('streetlightCoverage'), {
    type: 'FeatureCollection',
    features: [],
  });
  assert.equal(adapter.boxSelection, null);
  assert.equal(
    [...adapter.listeners.values()].some((listeners) => listeners.size > 0),
    false,
  );
  assert.equal(adapter.markers.size, 0);
  const restoreTerritory = lifecycle.present(territory);
  assert.equal(adapter.layers.get('territory-boundary-fill')?.visible, true);
  assert.equal(adapter.layers.get('territory-boundary-line')?.visible, true);
  restoreTerritory();
  releaseCoverage();
  assert.equal(adapter.layers.get('streetlight-coverage')?.visible, false);
  lifecycle.dispose();
});

test('stale readiness from a detached map cannot publish into either map epoch', async () => {
  let releaseFirst = () => {};
  const first = new TestMapAdapter();
  first.ready = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const second = new TestMapAdapter();
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  lifecycle.present(base());
  lifecycle.attach(first);
  lifecycle.attach(second);
  await turn();
  releaseFirst();
  await turn();

  assert.equal(first.sources.size, 0);
  assert.equal(second.sources.has('streetlightBoundary'), true);
  assert.equal(second.layers.get('streetlight-boundary')?.visible, false);
  const hideCoverage = lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: false,
    segments: [],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: false,
    fitOnFirstShow: false,
    onSelectSegment() {},
  });
  assert.equal(second.layers.get('streetlight-boundary')?.visible, true);
  hideCoverage();
  assert.equal(second.layers.get('streetlight-boundary')?.visible, false);
  lifecycle.dispose();
});

test('a readiness failure reports one stable product error without publishing overlays', async () => {
  const statuses: Array<{ state: string; message?: string }> = [];
  const lifecycle = createMapOverlayLifecycle({ onStatus: (status) => statuses.push(status) });
  const adapter = new TestMapAdapter();
  adapter.ready = Promise.reject(new Error('provider detail'));
  lifecycle.present(base());
  lifecycle.attach(adapter);
  await turn();

  assert.deepEqual(statuses, [
    { state: 'loading' },
    { state: 'error', message: 'Open map could not load.' },
  ]);
  assert.equal(adapter.sources.size, 0);
  lifecycle.dispose();
});

test('a cluster result cannot move the camera after its presentation epoch is gone', async () => {
  let releaseCluster = (_zoom: number) => {};
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  adapter.clusterZoom = new Promise<number>((resolve) => {
    releaseCluster = resolve;
  });
  const cleanup = lifecycle.present({
    kind: 'coverage',
    visible: true,
    interactive: false,
    segments: [],
    apartments: [],
    selectedSegmentId: null,
    selectionSource: null,
    showApartmentMarkers: true,
    fitOnFirstShow: false,
    onSelectSegment() {},
  });
  lifecycle.attach(adapter);
  await turn();
  adapter.emit('click', 'streetlight-apartment-clusters', {
    features: [
      {
        geometry: { type: 'Point', coordinates: [-117.1, 33.5] },
        properties: { cluster_id: 27 },
      },
    ],
  });
  cleanup();
  releaseCluster(15);
  await turn();

  assert.deepEqual(adapter.eases, []);
  lifecycle.dispose();
});

test('progress intent grows active roads and hides its stable layers on cleanup', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  const workspace: CoverageWorkspace = {
    id: 'territory-one',
    churchName: 'Test church',
    name: 'Test territory',
    center: [-117.1, 33.5],
    asOf: '2026-08-25',
    activePackets: 0,
    latestBatch: null,
    thresholds: { yellowAfterDays: 90, orangeAfterDays: 180, redAfterDays: 365 },
    legend: [],
    dataMode: 'canonical',
    qualityWarnings: [],
    apartmentComplexes: [],
    segments: [
      {
        id: 'segment-one',
        roadGroupId: 'road-one',
        streetName: 'Main Street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-117.1, 33.5],
            [-117.09, 33.5],
          ],
        },
        estimatedHomes: 10,
        eligible: true,
        excludedReason: null,
        lastCoveredOn: '2026-01-02',
        coverageClass: 'green',
        roots: [],
      },
    ],
    totals: { eligibleHomes: 10 },
  };
  const cleanup = lifecycle.present({
    animated: true,
    cinematic: true,
    fitForPrint: false,
    kind: 'progress',
    position: 0.245,
    visible: true,
    progress: {
      mode: 'calendar',
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      dates: ['2026-01-02'],
      events: [],
      units: [
        {
          id: 'segment-one',
          kind: 'street',
          streetKey: 'main street',
          completedOn: '2026-01-02',
          estimatedHomes: 10,
          geometry: workspace.segments[0].geometry,
        },
      ],
    },
    workspace,
  });
  lifecycle.attach(adapter);
  await turn();

  const progress = adapter.sources.get('streetlightProgress') as { features: unknown[] };
  const completed = adapter.sources.get('streetlightProgressCompleted') as {
    features: unknown[];
  };
  const active = adapter.sources.get('streetlightProgressActive') as {
    features: Array<{ geometry: { coordinates: Array<[number, number]> } }>;
  };
  assert.equal(progress.features.length, 1);
  assert.equal(completed.features.length, 0);
  assert.equal(active.features.length, 1);
  const activeCoordinates = active.features[0]?.geometry.coordinates;
  assert.deepEqual(activeCoordinates?.[0], [-117.1, 33.5]);
  assert.ok(Math.abs((activeCoordinates?.[1]?.[0] ?? 0) - -117.09925) < 1e-10);
  const mask = adapter.progressMasks.at(-1);
  assert.equal(mask?.visible, true);
  assert.deepEqual(mask?.lines, []);
  assert.deepEqual(mask?.active?.lines, [activeCoordinates]);
  assert.ok(Math.abs((mask?.active?.opacity ?? 0) - 0.216) < 1e-10);
  assert.equal(adapter.layers.has('streetlight-progress-shade'), false);
  assert.equal(adapter.layers.has('streetlight-progress-clearing'), false);
  assert.equal(adapter.layers.has('streetlight-progress-glow'), false);
  assert.equal(adapter.layers.get('streetlight-progress-lines')?.visible, true);
  assert.equal(adapter.layers.get('streetlight-progress-lines-active')?.visible, true);
  cleanup();
  assert.deepEqual(adapter.progressMasks.at(-1), { visible: false, lines: [] });
  assert.equal(adapter.layers.get('streetlight-progress-lines')?.visible, false);
  lifecycle.dispose();
});

test('print progress centers the church and fits every reached street', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  const presentation = {
    animated: false,
    cinematic: false,
    fitForPrint: true,
    kind: 'progress',
    position: 1,
    visible: true,
    progress: {
      mode: 'calendar',
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      dates: ['2026-01-02'],
      events: [],
      units: [
        {
          id: 'segment-one',
          kind: 'street',
          streetKey: 'main street',
          completedOn: '2026-01-02',
          estimatedHomes: 10,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-2, -1],
              [3, 4],
            ],
          },
        },
      ],
    },
    workspace: {
      center: [0, 0],
      segments: [],
      apartmentComplexes: [],
    } as unknown as CoverageWorkspace,
  } satisfies WorkspaceMapPresentation;
  const release = lifecycle.present(presentation);
  lifecycle.attach(adapter);
  await turn();

  assert.equal(adapter.resizes, 1);
  assert.deepEqual(adapter.fits, [
    {
      bounds: [
        [-3, -4],
        [3, 4],
      ],
      options: { duration: 0, maxZoom: 16, padding: 24 },
    },
  ]);
  const releaseAdmin = lifecycle.present({ ...presentation, fitForPrint: false });
  await turn();
  assert.equal(adapter.resizes, 2);
  releaseAdmin();
  release();
  lifecycle.dispose();
});

test('proposal and reconciliation focus keys do not repeat camera work', async () => {
  const lifecycle = createMapOverlayLifecycle({ onStatus() {} });
  const adapter = new TestMapAdapter();
  lifecycle.attach(adapter);
  await turn();
  const proposal: PacketProposal = {
    targetHomes: 12,
    estimatedHomes: 10,
    coverageClass: 'red' as const,
    segments: [
      {
        id: 'segment-one',
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [-117.1, 33.5],
            [-117.09, 33.5],
          ],
        },
        estimatedHomes: 10,
      },
    ],
    start: { address: '1 Main Street', position: [-117.1, 33.5] as [number, number] },
    streetNames: ['Main Street'],
  };
  lifecycle.present({ kind: 'proposals', visible: true, proposals: [proposal], selectedIndex: 0 });
  const batch: ReconciliationBatch = {
    id: 'batch-one',
    name: 'Batch one',
    status: 'finalized' as const,
    finalizedAt: '2026-01-01T00:00:00Z',
    packets: [
      {
        id: 'packet-one',
        code: 'A1',
        kind: 'street' as const,
        status: 'active' as const,
        estimatedTracts: 10,
        start: proposal.start,
        segments: proposal.segments,
        apartment: null,
        completedOn: null,
        history: [],
      },
    ],
    counts: { active: 1, completed: 0, cancelled: 0 },
  };
  const presentation = projectReconciliation(
    { asOf: '2026-01-01', defaultBatchId: batch.id, batches: [batch] },
    {
      batchId: batch.id,
      outcomes: new Map([['packet-one', 'still-here'] as const]),
      selectedPacketId: 'packet-one',
      view: 'active',
    },
  ).map;
  lifecycle.present({
    kind: 'reconciliation',
    visible: true,
    presentation,
  });
  await turn();
  const focusCount = adapter.fits.length;
  lifecycle.present({
    kind: 'reconciliation',
    visible: true,
    presentation,
  });
  await turn();

  assert.equal(adapter.layers.has('streetlight-packet-proposals-halo'), true);
  assert.equal(adapter.layers.has('streetlight-reconciliation-halo'), true);
  assert.deepEqual(adapter.layers.get('streetlight-reconciliation-line')?.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['+', 2, ['case', ['get', 'selected'], 2, 0]],
    14,
    ['+', 5, ['case', ['get', 'selected'], 2, 0]],
  ]);
  assert.equal(adapter.markers.has('proposal:1 Main Street:-117.1,33.5'), true);
  assert.equal(adapter.markers.has('reconciliation-start:packet-one'), true);
  assert.equal(adapter.fits.length, focusCount);
  lifecycle.dispose();
});
