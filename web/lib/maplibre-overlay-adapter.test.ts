import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { WorkspaceMapBasePresentation } from './map-overlay-lifecycle.ts';
import { createMapLibreOverlayAdapter } from './maplibre-overlay-adapter.ts';

class FakeMap extends EventEmitter {
  readonly canvas = { style: { cursor: '' } };
  loadedValue = false;
  styleLoadedValue = false;
  styleReplacements = 0;

  getCanvas() {
    return this.canvas;
  }

  loaded() {
    return this.loadedValue;
  }

  isStyleLoaded() {
    return this.styleLoadedValue;
  }

  setStyle() {
    this.styleReplacements += 1;
    return this;
  }
}

const base = (mapType: 'roadmap' | 'satellite' = 'roadmap'): WorkspaceMapBasePresentation => ({
  kind: 'base',
  mapType,
  data: {
    churchId: 'church-one',
    territoryId: 'territory-one',
    territoryName: 'Test territory',
    center: [-117.1, 33.5],
    bounds: [-117.2, 33.4, -117, 33.6],
    boundary: {
      type: 'Polygon',
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
    buildingMode: 'overture_only',
    segments: [],
    apartmentComplexes: [],
    buildings: [],
    houseNumbers: [],
    attribution: { base: 'Base', roads: 'Roads', buildings: 'Buildings', fema: null },
  },
});

const adapterFor = (map: FakeMap) =>
  createMapLibreOverlayAdapter(map as unknown as MapLibreMap, null as never, base());

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('initial readiness waits for the map load event after the initial style event is gone', async () => {
  const map = new FakeMap();
  map.emit('style.load');
  const adapter = adapterFor(map);
  let ready = false;
  const readiness = adapter.waitUntilReady().then(() => {
    ready = true;
  });

  assert.equal(map.listenerCount('load'), 1);
  assert.equal(map.listenerCount('style.load'), 0);
  map.emit('style.load');
  await turn();
  assert.equal(ready, false);

  map.emit('load');
  await readiness;
  assert.equal(ready, true);
});

test('initial readiness resolves immediately when the map or style is already loaded', async () => {
  for (const state of ['map', 'style'] as const) {
    const map = new FakeMap();
    map.loadedValue = state === 'map';
    map.styleLoadedValue = state === 'style';
    const adapter = adapterFor(map);
    let ready = false;

    void adapter.waitUntilReady().then(
      () => {
        ready = true;
      },
      () => {},
    );
    await turn();
    assert.equal(ready, true);
    assert.equal(map.listenerCount('load'), 0);
    assert.equal(map.listenerCount('style.load'), 0);
    adapter.dispose();
  }
});

test('style replacement waits for its style load rather than a map load', async () => {
  const map = new FakeMap();
  const adapter = adapterFor(map);
  let replaced = false;
  const replacement = adapter.replaceStyle(base('satellite')).then(() => {
    replaced = true;
  });

  assert.equal(map.styleReplacements, 1);
  assert.equal(map.listenerCount('load'), 0);
  assert.equal(map.listenerCount('style.load'), 1);
  map.emit('load');
  await turn();
  assert.equal(replaced, false);

  map.emit('style.load');
  await replacement;
  assert.equal(replaced, true);
});
