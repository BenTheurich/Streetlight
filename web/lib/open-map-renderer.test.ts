import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
      start: { address: '1 Main Street', position: [0, 0] },
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
      buildings: [],
    },
  ],
};

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

test('render document is pinned, printable, and does not label a house number', () => {
  const input: OpenMapRenderInput = {
    packetId: 'packet-one',
    start: [0, 0],
    view: { center: [0.0005, 0], zoom: 19 },
    style: { version: 8, sources: {}, layers: [] },
    attribution: 'OpenFreeMap · Overture Maps',
  };
  const html = packetMapDocument(input, 'window.maplibregl = fake;', '.maplibregl-map{}');

  assert.match(html, /width: 1280px; height: 1280px/);
  assert.match(html, /OpenFreeMap · Overture Maps/);
  assert.doesNotMatch(html, /1 Main Street|unpkg|house-number/);
  assert.match(html, /window\.__mapReady/);
});
