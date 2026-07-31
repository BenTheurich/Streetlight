import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  captureOpenPacketPages,
  type OpenMapRenderInput,
  packetMapDocument,
  renderOpenPacketMaps,
} from './open-map-renderer.ts';
import type { PacketDownloadSelection } from './packet-finalization.ts';

const png = new Uint8Array([1, 2, 3]);
const selection: PacketDownloadSelection = {
  scope: 'newest',
  packets: [
    {
      kind: 'street',
      apartmentId: null,
      id: 'packet-one',
      code: 'TEM-001',
      batchId: 'batch-one',
      batchName: 'Outreach',
      importGeneration: 1,
      estimatedHomes: 12,
      start: { address: '1 Main Street', position: [0.00013, 0.00005] },
      segments: [
        {
          id: 'selected',
          streetName: 'Main Street',
          roadClass: 'residential',
          estimatedHomes: 12,
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.001, 0],
            ],
          },
        },
      ],
    },
  ],
  mapGenerations: [
    {
      importGeneration: 1,
      overtureRelease: '2026-06-17.0',
      networkSegments: [
        {
          id: 'selected',
          streetName: 'Main Street',
          roadClass: 'residential',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.001, 0],
            ],
          },
        },
      ],
      buildings: [
        {
          source: 'overture',
          sourceId: 'building-one',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0.0001, 0],
                [0.0001, 0.0001],
                [0, 0.0001],
                [0, 0],
              ],
            ],
          },
          fema: null,
        },
      ],
      houseNumbers: [{ number: '1', street: 'Main Street', position: [0.00013, 0.00005] }],
    },
  ],
};

test('captures at most three packet maps concurrently and preserves packet order', async () => {
  const inputs = Array.from({ length: 6 }, (_, index) => ({
    packetId: `packet-${index}`,
  })) as OpenMapRenderInput[];
  let active = 0;
  let maximumActive = 0;

  const images = await captureOpenPacketPages(inputs, async ({ packetId }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const index = Number(packetId.slice('packet-'.length));
    await new Promise((resolve) => setTimeout(resolve, (6 - index) * 2));
    active -= 1;
    return new Uint8Array([index]);
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(
    images.map((image) => image[0]),
    [0, 1, 2, 3, 4, 5],
  );
});

test('renders every packet with its recorded map generation', async () => {
  const received: OpenMapRenderInput[][] = [];
  const images = await renderOpenPacketMaps(selection, async (input) => {
    received.push(input);
    return [png];
  });

  assert.deepEqual(images.get('packet-one'), png);
  assert.equal(received.length, 1);
  assert.equal(received[0][0].packetId, 'packet-one');
  assert.equal(received[0][0].view.zoom, 19);
  assert.equal(received[0][0].start.number, '1');
  assert(Math.abs(received[0][0].start.position[0] - 0.00005) < 1e-12);
  assert(Math.abs(received[0][0].start.position[1] - 0.00005) < 1e-12);
  assert(received[0][0].style.layers.some(({ id }) => id === 'streetlight-route'));
});

test('retries one complete transient capture failure and then fails clearly', async () => {
  let attempts = 0;
  const images = await renderOpenPacketMaps(selection, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('tiles unavailable');
    return [png];
  });
  assert.equal(attempts, 2);
  assert.deepEqual(images.get('packet-one'), png);

  await assert.rejects(
    renderOpenPacketMaps(selection, async () => {
      throw new Error('tiles unavailable');
    }),
    /Could not render packet maps/,
  );
});

test('render document labels only the starting house number beneath the pin', () => {
  const input: OpenMapRenderInput = {
    packetId: 'packet-one',
    start: { number: '40192', position: [0, 0] },
    view: { center: [0.0005, 0], zoom: 19 },
    style: { version: 8, sources: {}, layers: [] },
    attribution: 'OpenFreeMap · Overture Maps',
  };
  const html = packetMapDocument(input, 'window.maplibregl = fake;', '.maplibregl-map{}');

  assert.match(html, /width: 1280px; height: 1280px/);
  assert.match(html, /OpenFreeMap · Overture Maps/);
  assert.match(html, /number\.textContent = "40192"/);
  assert.doesNotMatch(html, /1 Main Street|unpkg/);
  assert.match(html, /window\.__mapReady/);
});

test('render document offers a collision-safe fallback only when the native label is absent', async () => {
  const input: OpenMapRenderInput = {
    packetId: 'packet-one',
    start: { number: '1', position: [0, 0] },
    view: { center: [0.0005, 0], zoom: 19 },
    style: {
      version: 8,
      sources: {
        streetlightRouteFallbackLabels: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [0, 0],
                    [0.001, 0],
                  ],
                },
                properties: {
                  streetName: 'N General Kearny Rd',
                  streetNameKey: 'NORTH GENERAL KEARNY ROAD',
                },
              },
            ],
          },
        },
      },
      layers: [],
    },
    attribution: 'OpenFreeMap',
  };
  const fakeMapLibre = `
    window.__addedLayers = [];
    class FakeMap {
      constructor() { setTimeout(() => this.emitIdle(), 0); }
      once(name, callback) { if (name === "idle") this.idle = callback; }
      on() {}
      emitIdle() { const callback = this.idle; this.idle = undefined; if (callback) callback(); }
      queryRenderedFeatures(options) {
        window.__queriedLayers = options.layers;
        return window.__renderedFeatures;
      }
      addLayer(layer) {
        window.__addedLayers.push(layer);
        setTimeout(() => this.emitIdle(), 0);
      }
    }
    class FakeMarker {
      setLngLat() { return this; }
      addTo() { return this; }
    }
    window.maplibregl = { Map: FakeMap, Marker: FakeMarker };
  `;
  const browser = await chromium.launch({ headless: true });
  try {
    const render = async (renderedFeatures: Array<{ properties: Record<string, string> }>) => {
      const page = await browser.newPage();
      await page.setContent(
        packetMapDocument(
          input,
          `window.__renderedFeatures = ${JSON.stringify(renderedFeatures)};${fakeMapLibre}`,
          '',
        ),
      );
      await page.waitForFunction(
        () => (window as unknown as { __mapReady?: boolean }).__mapReady === true,
      );
      const state = await page.evaluate(() => {
        const values = window as unknown as {
          __addedLayers: Array<{ filter: unknown[]; layout: Record<string, unknown> }>;
          __queriedLayers: string[];
        };
        return {
          addedLayers: values.__addedLayers,
          queriedLayers: values.__queriedLayers,
        };
      });
      await page.close();
      return state;
    };

    const missing = await render([]);
    assert.deepEqual(missing.queriedLayers, ['highway-name-minor', 'highway-name-major']);
    assert.equal(missing.addedLayers.length, 1);
    assert.deepEqual(missing.addedLayers[0].filter, [
      'in',
      ['get', 'streetNameKey'],
      ['literal', ['NORTH GENERAL KEARNY ROAD']],
    ]);
    assert.equal(missing.addedLayers[0].layout['text-allow-overlap'], false);
    assert.equal(missing.addedLayers[0].layout['text-ignore-placement'], false);
    assert.equal(missing.addedLayers[0].layout['symbol-avoid-edges'], true);

    const present = await render([{ properties: { name: ' N General Kearny Rd ' } }]);
    assert.deepEqual(present.addedLayers, []);
  } finally {
    await browser.close();
  }
});
