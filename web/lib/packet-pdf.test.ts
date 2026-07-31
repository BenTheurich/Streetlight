import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import type { DownloadPacket, PacketDownloadSelection } from './packet-finalization.ts';
import { googleMapsDirectionsUrl, renderPacketPdf } from './packet-pdf.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3z8AAAAASUVORK5CYII=',
  'base64',
);

function packet(id: string, code: string, offset = 0): DownloadPacket {
  return {
    kind: 'street',
    apartmentId: null,
    id,
    code,
    batchId: 'batch-a',
    batchName: 'Summer Outreach',
    importGeneration: 1,
    estimatedHomes: 32,
    start: {
      address: '31087 Nicolas Rd, Temecula, CA 92591',
      position: [-117.116885 + offset, 33.54293 + offset],
    },
    segments: [
      {
        id: `segment-${id}`,
        streetName: 'Nicolas Road',
        roadClass: 'residential',
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

test('PDF contains one Letter page per packet and uses every rendered map', async () => {
  const selection: PacketDownloadSelection = {
    scope: 'active',
    packets: [packet('packet-a', 'TEM-001'), packet('packet-b', 'TEM-002', 0.001)],
    mapGenerations: [],
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

test('long starting street fits before the QR panel', async () => {
  const value = packet('packet-a', 'TEM-001');
  value.start.address = '39859 N GENERAL KEARNY RD, TEMECULA 92591';
  const bytes = await renderPacketPdf(
    { scope: 'newest', packets: [value], mapGenerations: [] },
    { logo: png, renderMap: async () => png },
  );
  const document = await PDFDocument.load(bytes);
  const contents = document.getPages()[0].node.Contents();
  assert(contents instanceof PDFArray);
  const stream = document.context.lookup(contents.get(0)) as PDFRawStream;
  assert(stream instanceof PDFRawStream);
  const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const street = operators.match(
    /\/Helvetica-Bold-\d+ ([\d.]+) Tf\n24 TL\n1 0 0 1 318 724 Tm\n<3339383539204E2047454E4552414C204B4541524E59205244> Tj/,
  );
  assert(street);
  assert.ok((182.028 / 12) * Number(street[1]) <= 169);
});

test('provider failure rejects the complete PDF instead of returning partial bytes', async () => {
  const selection: PacketDownloadSelection = {
    scope: 'newest',
    packets: [packet('packet-a', 'TEM-001'), packet('packet-b', 'TEM-002', 0.001)],
    mapGenerations: [],
  };
  let calls = 0;

  await assert.rejects(
    renderPacketPdf(selection, {
      logo: png,
      renderMap: async () => {
        calls += 1;
        if (calls === 2) throw new Error('Open map unavailable');
        return png;
      },
    }),
    /Open map unavailable/,
  );
  assert.equal(calls, 2);
});
