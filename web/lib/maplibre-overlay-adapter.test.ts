import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { WorkspaceMapBasePresentation } from './map-overlay-lifecycle.ts';
import { createMapLibreOverlayAdapter } from './maplibre-overlay-adapter.ts';

class FakeElement extends EventTarget {
  readonly style: Record<string, string> = { cursor: '' };
  readonly children: FakeElement[] = [];
  className = '';
  clientHeight = 600;
  clientWidth = 800;
  removed = false;

  append(child: FakeElement) {
    this.children.push(child);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }

  remove() {
    this.removed = true;
  }
}

class FakeCanvasContext {
  fillStyle = '';
  filter = 'none';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineCap = '';
  lineJoin = '';
  lineWidth = 1;
  strokeStyle = '';
  readonly fills: Array<{ composite: string; style: string }> = [];
  readonly images: Array<{ alpha: number; composite: string; filter: string }> = [];
  readonly strokes: Array<{ alpha: number; composite: string; width: number }> = [];

  beginPath() {}

  clearRect() {}

  fillRect() {
    this.fills.push({ composite: this.globalCompositeOperation, style: this.fillStyle });
  }

  drawImage() {
    this.images.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      filter: this.filter,
    });
  }

  lineTo() {}

  moveTo() {}

  setTransform() {}

  stroke() {
    this.strokes.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      width: this.lineWidth,
    });
  }
}

class FakeCanvas extends FakeElement {
  readonly context = new FakeCanvasContext();
  ariaHidden = '';
  height = 0;
  hidden = false;
  width = 0;

  getContext() {
    return this.context;
  }
}

class FakeToggle {
  enabled = true;

  disable() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
  }

  isEnabled() {
    return this.enabled;
  }
}

class FakeMap extends EventEmitter {
  readonly canvas = new FakeElement();
  readonly container = new FakeElement();
  readonly boxZoom = new FakeToggle();
  readonly dragPan = new FakeToggle();
  readonly layers = new Set(['road']);
  renderedFeatures: Array<{ properties: Record<string, unknown> }> = [];
  rejectDegenerateBounds = false;
  loadedValue = false;
  styleLoadedValue = false;
  styleReplacements = 0;
  repaints = 0;

  triggerRepaint() {
    this.repaints += 1;
  }

  constructor() {
    super();
    this.container.clientHeight = 0;
  }

  getCanvas() {
    return this.canvas;
  }

  getCanvasContainer() {
    return this.container;
  }

  getZoom() {
    return 14;
  }

  project(coordinate: [number, number]) {
    return { x: coordinate[0], y: coordinate[1] };
  }

  getLayer(id: string) {
    return this.layers.has(id) ? { id } : undefined;
  }

  queryRenderedFeatures(geometry?: unknown) {
    if (
      this.rejectDegenerateBounds &&
      Array.isArray(geometry) &&
      Array.isArray(geometry[0]) &&
      Array.isArray(geometry[1]) &&
      geometry[0][0] === geometry[1][0] &&
      geometry[0][1] === geometry[1][1]
    ) {
      return [];
    }
    return this.renderedFeatures;
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

  emitMapError() {
    for (const listener of this.listeners('error')) listener({ error: new Error('Tile failed') });
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
    buildings: [],
    houseNumbers: [],
    attribution: { base: 'Base', roads: 'Roads', buildings: 'Buildings', fema: null },
  },
});

const adapterFor = (map: FakeMap) =>
  createMapLibreOverlayAdapter(map as unknown as MapLibreMap, null as never, base());

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('selection sends property diffs by stable feature ID without replacing source data', () => {
  const map = new FakeMap();
  const differences: unknown[] = [];
  Object.assign(map, {
    getSource: () => ({ updateData: (diff: unknown) => differences.push(diff) }),
  });
  const adapter = adapterFor(map);
  adapter.updateSourceProperties('streetlightCoverage', [
    { id: 'one', properties: { selected: true, opacity: 0.95 } },
    { id: 'two', properties: { selected: false } },
  ]);
  assert.deepEqual(differences, [
    {
      update: [
        {
          id: 'one',
          addOrUpdateProperties: [
            { key: 'selected', value: true },
            { key: 'opacity', value: 0.95 },
          ],
        },
        { id: 'two', addOrUpdateProperties: [{ key: 'selected', value: false }] },
      ],
    },
  ]);
  adapter.dispose();
});

function installDom(createElement: (tagName: string) => FakeElement = () => new FakeElement()) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement },
  });
  return () => {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  };
}

test('progress mask unions completed and active roads before erasing the dark overlay', (context) => {
  const mask = new FakeCanvas();
  const cutout = new FakeCanvas();
  const canvases = [mask, cutout];
  context.after(
    installDom((tagName) =>
      tagName === 'canvas' ? (canvases.shift() ?? new FakeCanvas()) : new FakeElement(),
    ),
  );
  const map = new FakeMap();
  const adapter = adapterFor(map);

  adapter.setProgressMask({
    visible: true,
    lines: [
      [
        [-117.1, 33.5],
        [-117.09, 33.5],
      ],
    ],
    active: {
      lines: [
        [
          [-117.08, 33.5],
          [-117.07, 33.5],
        ],
      ],
      opacity: 0.25,
    },
  });

  assert.equal(map.container.children[0], mask);
  assert.deepEqual(mask.context.fills, [{ composite: 'source-over', style: 'rgb(7 17 31 / 46%)' }]);
  assert.deepEqual(cutout.context.strokes, [
    { alpha: 1, composite: 'source-over', width: 38 },
    { alpha: 0.25, composite: 'source-over', width: 38 },
  ]);
  assert.deepEqual(mask.context.images, [
    { alpha: 1, composite: 'destination-out', filter: 'blur(12px)' },
  ]);

  adapter.setProgressMask({ visible: false, lines: [] });
  assert.equal(mask.hidden, true);
  adapter.dispose();
  assert.equal(mask.removed, true);
  assert.equal(map.listenerCount('move'), 0);
  assert.equal(map.listenerCount('resize'), 0);
});

function domEvent(type: string, properties: Record<string, unknown>) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

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

test('print readiness waits for a rendered idle frame, not a loaded style or an ordinary render', async () => {
  const map = new FakeMap();
  map.loadedValue = true;
  const adapter = adapterFor(map);
  let settled = false;
  const ready = adapter.waitUntilSettled(new AbortController().signal).then(() => {
    settled = true;
  });
  assert.equal(map.repaints, 1);
  map.emit('render');
  map.emit('style.load');
  await turn();
  assert.equal(settled, false);
  map.emit('idle');
  await ready;
  assert.equal(settled, true);
  assert.equal(map.listenerCount('idle'), 0);
  assert.equal(map.listenerCount('error'), 0);
});

test('print readiness rejects and removes listeners after error, cancellation, or map detachment', async () => {
  for (const failure of ['error', 'cancel', 'detach']) {
    const map = new FakeMap();
    const adapter = adapterFor(map);
    const controller = new AbortController();
    const rejected = assert.rejects(adapter.waitUntilSettled(controller.signal));
    if (failure === 'error') map.emitMapError();
    else if (failure === 'cancel') controller.abort();
    else adapter.dispose();
    await rejected;
    assert.equal(map.listenerCount('idle'), 0);
    assert.equal(map.listenerCount('error'), 0);
  }
});

test('a recoverable map error does not consume the initial load listener', async () => {
  const map = new FakeMap();
  const adapter = adapterFor(map);
  const readiness = adapter.waitUntilReady();

  map.emitMapError();
  map.emit('load');
  await readiness;

  assert.equal(map.listenerCount('load'), 0);
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.listenerCount('error'), 0);
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

test('a recoverable map error does not consume the replacement style listener', async () => {
  const map = new FakeMap();
  const adapter = adapterFor(map);
  const replacement = adapter.replaceStyle(base('satellite'));

  map.emitMapError();
  map.emit('style.load');
  await replacement;

  assert.equal(map.listenerCount('load'), 0);
  assert.equal(map.listenerCount('style.load'), 0);
  assert.equal(map.listenerCount('error'), 0);
});

test('box selection cursor follows Shift and resets after a drag', (context) => {
  context.after(installDom());
  const map = new FakeMap();
  const adapter = adapterFor(map);
  const release = adapter.registerBoxSelection({
    armed: false,
    layerIds: ['road'],
    onComplete() {},
    onEmptyClick() {},
  });

  window.dispatchEvent(domEvent('keydown', { key: 'Shift' }));
  assert.equal(map.canvas.style.cursor, 'crosshair');
  adapter.setCursor('pointer');
  assert.equal(map.canvas.style.cursor, 'crosshair');
  window.dispatchEvent(domEvent('keyup', { key: 'Shift' }));
  assert.equal(map.canvas.style.cursor, '');

  window.dispatchEvent(domEvent('keydown', { key: 'Shift' }));
  map.container.dispatchEvent(
    domEvent('mousedown', { button: 0, clientX: 10, clientY: 10, shiftKey: true }),
  );
  window.dispatchEvent(domEvent('keyup', { key: 'Shift' }));
  assert.equal(map.canvas.style.cursor, 'crosshair');
  window.dispatchEvent(domEvent('mouseup', { clientX: 30, clientY: 30, shiftKey: false }));
  assert.equal(map.canvas.style.cursor, '');

  release();
});

test('more than three hidden-road Shift clicks remain additive across adapter rebindings', (context) => {
  context.after(installDom());
  const map = new FakeMap();
  map.layers.add('streetlight-territory-hidden');
  map.rejectDegenerateBounds = true;
  const adapter = adapterFor(map);
  let selected = ['hidden-road-one'];
  let release = () => {};
  const bind = () => {
    release();
    release = adapter.registerBoxSelection({
      armed: false,
      layerIds: ['streetlight-territory-hidden'],
      onComplete(ids, additive) {
        if (!additive) {
          selected = [...new Set(ids)];
          return;
        }
        const next = new Set(selected);
        for (const id of ids) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        selected = [...next];
      },
      onEmptyClick() {},
    });
  };
  bind();
  window.dispatchEvent(domEvent('keydown', { key: 'Shift' }));

  for (const [index, id] of [
    'hidden-road-two',
    'hidden-road-three',
    'hidden-road-four',
  ].entries()) {
    map.renderedFeatures = [{ properties: { id, selectable: true } }];
    map.container.dispatchEvent(
      domEvent('mousedown', {
        button: 0,
        clientX: 10 + index,
        clientY: 10 + index,
        shiftKey: true,
      }),
    );
    window.dispatchEvent(
      domEvent('mouseup', {
        clientX: 10 + index,
        clientY: 10 + index,
        shiftKey: true,
      }),
    );
    bind();
    map.emit('click', {
      originalEvent: { shiftKey: true },
      point: { x: 10 + index, y: 10 + index },
    });
  }

  assert.deepEqual(selected, [
    'hidden-road-one',
    'hidden-road-two',
    'hidden-road-three',
    'hidden-road-four',
  ]);
  release();
});

test('armed box selection returns to the map cursor when the gesture completes', (context) => {
  context.after(installDom());
  const map = new FakeMap();
  const adapter = adapterFor(map);
  let emptyClicks = 0;
  let release = adapter.registerBoxSelection({
    armed: true,
    layerIds: ['road'],
    onComplete() {},
    onEmptyClick: () => {
      emptyClicks += 1;
    },
  });

  assert.equal(map.canvas.style.cursor, 'crosshair');
  map.container.dispatchEvent(
    domEvent('mousedown', { button: 0, clientX: 10, clientY: 10, shiftKey: false }),
  );
  window.dispatchEvent(domEvent('mouseup', { clientX: 30, clientY: 30, shiftKey: false }));
  assert.equal(map.canvas.style.cursor, '');

  release();
  release = adapter.registerBoxSelection({
    armed: false,
    layerIds: ['road'],
    onComplete() {},
    onEmptyClick: () => {
      emptyClicks += 1;
    },
  });
  map.emit('click', { originalEvent: { shiftKey: false }, point: { x: 30, y: 30 } });
  assert.equal(emptyClicks, 0);

  map.container.dispatchEvent(
    domEvent('mousedown', { button: 0, clientX: 40, clientY: 40, shiftKey: false }),
  );
  map.emit('click', { originalEvent: { shiftKey: false }, point: { x: 40, y: 40 } });
  assert.equal(emptyClicks, 1);

  release();
});

test('plain empty-map clicks clear selection without affecting road or Shift clicks', (context) => {
  context.after(installDom());
  const map = new FakeMap();
  const adapter = adapterFor(map);
  let emptyClicks = 0;
  const release = adapter.registerBoxSelection({
    armed: false,
    layerIds: ['road'],
    onComplete() {},
    onEmptyClick: () => {
      emptyClicks += 1;
    },
  });

  map.emit('click', { originalEvent: { shiftKey: false }, point: { x: 10, y: 10 } });
  assert.equal(emptyClicks, 1);

  map.renderedFeatures = [{ properties: { id: 'road-one', selectable: true } }];
  map.emit('click', { originalEvent: { shiftKey: false }, point: { x: 10, y: 10 } });
  assert.equal(emptyClicks, 1);

  map.renderedFeatures = [];
  map.emit('click', { originalEvent: { shiftKey: true }, point: { x: 10, y: 10 } });
  assert.equal(emptyClicks, 1);

  release();
});
