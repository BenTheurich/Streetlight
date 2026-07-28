import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { DownloadPacket, PacketDownloadSelection } from './packet-finalization.ts';
import { googleMapsDirectionsUrl, renderPacketMap, renderPacketPdf } from './packet-pdf.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3z8AAAAASUVORK5CYII=',
  'base64',
);

function packet(id: string, code: string, offset = 0): DownloadPacket {
  return {
    id,
    code,
    batchId: 'batch-a',
    batchName: 'Summer Outreach',
    estimatedHomes: 32,
    start: {
      address: '31087 Nicolas Rd, Temecula, CA 92591',
      position: [-117.116885 + offset, 33.54293 + offset],
    },
    segments: [
      {
        id: `segment-${id}`,
        estimatedHomes: 32,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-117.1169 + offset, 33.5429 + offset],
            [-117.1168 + offset, 33.543 + offset],
          ],
        },
      },
    ],
  };
}

test('Google directions URL targets the stored starting address', () => {
  assert.equal(
    googleMapsDirectionsUrl('31087 Nicolas Rd, Temecula, CA 92591'),
    'https://www.google.com/maps/dir/?api=1&destination=31087%20Nicolas%20Rd%2C%20Temecula%2C%20CA%2092591&travelmode=walking',
  );
});

test('packet map snaps each segment and requests one tightly fitted static image', async () => {
  const calls: string[] = [];
  const fetchMap: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://roads.googleapis.com/')) {
      return Response.json({
        snappedPoints: [
          { location: { longitude: -117.1169, latitude: 33.5429 } },
          { location: { longitude: -117.1168, latitude: 33.543 } },
        ],
      });
    }
    return new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  };

  const image = await renderPacketMap(packet('packet-a', 'TEM-001'), 'server-key', fetchMap);

  assert.deepEqual(image, new Uint8Array(png));
  assert.equal(calls.length, 2);
  assert.match(calls[0], /roads\.googleapis\.com\/v1\/snapToRoads/);
  assert.match(calls[0], /interpolate=true/);
  assert.match(calls[0], /key=server-key/);
  assert.match(calls[1], /maps\.googleapis\.com\/maps\/api\/staticmap/);
  assert.match(calls[1], /size=640x640/);
  assert.match(calls[1], /scale=2/);
  assert.match(calls[1], /maptype=roadmap/);
  assert.match(calls[1], /markers=33\.5429300%2C-117\.1168850/);
  assert.match(calls[1], /path=color%3A0xef6c3599%7Cweight%3A6%7Cenc%3A/);
});

test('PDF contains one Letter page per packet and uses every rendered map', async () => {
  const selection: PacketDownloadSelection = {
    scope: 'active',
    packets: [packet('packet-a', 'TEM-001'), packet('packet-b', 'TEM-002', 0.001)],
  };
  const rendered: string[] = [];

  const bytes = await renderPacketPdf(selection, {
    logo: png,
    renderMap: async (value) => {
      rendered.push(value.code);
      return png;
    },
  });

  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 2);
  assert.equal(document.getTitle(), 'Streetlight active outreach packets');
  assert.deepEqual(rendered, ['TEM-001', 'TEM-002']);
  for (const page of document.getPages()) {
    assert.deepEqual(page.getSize(), { width: 612, height: 792 });
  }
});

test('provider failure rejects the complete PDF instead of returning partial bytes', async () => {
  const selection: PacketDownloadSelection = {
    scope: 'newest',
    packets: [packet('packet-a', 'TEM-001'), packet('packet-b', 'TEM-002', 0.001)],
  };
  let calls = 0;

  await assert.rejects(
    renderPacketPdf(selection, {
      logo: png,
      renderMap: async () => {
        calls += 1;
        if (calls === 2) throw new Error('Static Maps unavailable');
        return png;
      },
    }),
    /Static Maps unavailable/,
  );
  assert.equal(calls, 2);
});
