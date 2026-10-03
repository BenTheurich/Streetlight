import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import type {
  DownloadPacket,
  PacketDownloadSelection,
  PacketMapGeneration,
} from './packet-finalization.ts';
import {
  googleMapsDirectionsUrl,
  PRINT_STREETLIGHT_CREDITS_URL,
  renderPacketPdf,
} from './packet-pdf.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3z8AAAAASUVORK5CYII=',
  'base64',
);

const generation: PacketMapGeneration = {
  importGeneration: 1,
  overtureRelease: '2026-06-17.0',
  networkSegments: [],
  buildings: [],
  houseNumbers: [],
};

function packet(id: string, code: string, offset = 0): DownloadPacket {
  return {
    kind: 'street',
    apartmentId: null,
    accessStatus: null,
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
    mapGenerations: [generation],
  };
  const rendered: string[] = [];

  const bytes = await renderPacketPdf(selection, {
    logo: png,
    footer: { message: 'Ye are the light of the world.', reference: 'Matthew 5:14' },
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

test('PDF draws the church printout message in every footer', async () => {
  const bytes = await renderPacketPdf(
    { scope: 'newest', packets: [packet('packet-a', 'TEM-001')], mapGenerations: [generation] },
    {
      logo: png,
      footer: { message: 'Ye are the light of the world.', reference: 'Matthew 5:14' },
      renderMap: async () => png,
    },
  );
  const document = await PDFDocument.load(bytes);
  const contents = document.getPages()[0].node.Contents();
  assert(contents instanceof PDFArray);
  const stream = document.context.lookup(contents.get(0)) as PDFRawStream;
  assert(stream instanceof PDFRawStream);
  const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');

  assert.equal(operators.match(/\/Image-\d+ Do/g)?.length, 3);
  assert.match(operators, /59652061726520746865206C69676874206F662074686520776F726C642E/i);
});

test('restricted apartment packets carry an access warning', async () => {
  const value = packet('apartment-a', 'TEM-A01');
  value.kind = 'apartment';
  value.apartmentId = 'site-a';
  value.accessStatus = 'restricted';
  value.segments = [];
  const bytes = await renderPacketPdf(
    { scope: 'newest', packets: [value], mapGenerations: [generation] },
    {
      logo: png,
      footer: { message: '', reference: '' },
      renderMap: async () => png,
    },
  );
  const document = await PDFDocument.load(bytes);
  const contents = document.getPages()[0].node.Contents();
  assert(contents instanceof PDFArray);
  const stream = document.context.lookup(contents.get(0)) as PDFRawStream;
  const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  assert.match(operators, /5245535452494354454420414343455353/i);
});

test('long starting street fits before the QR panel', async () => {
  const value = packet('packet-a', 'TEM-001');
  value.start.address = '39859 N GENERAL KEARNY RD, TEMECULA 92591';
  const bytes = await renderPacketPdf(
    { scope: 'newest', packets: [value], mapGenerations: [generation] },
    {
      logo: png,
      footer: { message: 'Ye are the light of the world.', reference: 'Matthew 5:14' },
      renderMap: async () => png,
    },
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
    mapGenerations: [generation],
  };
  let calls = 0;

  await assert.rejects(
    renderPacketPdf(selection, {
      logo: png,
      footer: { message: 'Ye are the light of the world.', reference: 'Matthew 5:14' },
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

test('pilot and rollout PDFs retain printed OSM and linked notices, with readable credits for each stored generation', async () => {
  const withFema: PacketMapGeneration = {
    ...generation,
    importGeneration: 2,
    buildings: [
      {
        source: 'fema',
        sourceId: 'fema-one',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [0.001, 0],
              [0.001, 0.001],
              [0, 0],
            ],
          ],
        },
        fema: {
          addressSourceId: 'address-one',
          distanceMeters: 1,
          occupancy: 'Single Family Dwelling',
          outbuilding: false,
          source: 'USA Structures',
          productDate: null,
          imageDate: null,
        },
      },
    ],
  };
  const second = { ...packet('packet-b', 'TEM-002'), importGeneration: 2 };
  for (const printStreetlightCreditsUrl of [undefined, false, true]) {
    const printsStreetlightUrl = printStreetlightCreditsUrl ?? PRINT_STREETLIGHT_CREDITS_URL;
    const bytes = await renderPacketPdf(
      {
        scope: 'active',
        packets: [packet('packet-a', 'TEM-001'), second],
        mapGenerations: [generation, withFema],
      },
      {
        logo: png,
        footer: { message: '', reference: '' },
        renderMap: async () => png,
        printStreetlightCreditsUrl,
      },
    );
    const document = await PDFDocument.load(bytes);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const sourceUrl = printsStreetlightUrl
      ? 'openstreetmap.org/copyright · streetlight.bentheurich.com/map-data.html'
      : 'openstreetmap.org/copyright';
    for (const [index, page] of document.getPages().entries()) {
      const contents = page.node.Contents();
      assert(contents instanceof PDFArray);
      const stream = document.context.lookup(contents.get(0)) as PDFRawStream;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      const credits =
        '© OpenMapTiles.org · © OpenStreetMap · Overture Maps (ODbL)' +
        (index === 1 ? ' · ORNL/FEMA' : '');
      for (const [text, baseline] of [
        [credits, 84],
        [sourceUrl, 74],
      ] as const) {
        const width = font.widthOfTextAtSize(text, 7);
        const position = operators.match(
          new RegExp(
            `/Helvetica-\\d+ 7 Tf\\n24 TL\\n1 0 0 1 ([\\d.]+) ${baseline} Tm\\n${font.encodeText(text)} Tj`,
          ),
        );
        assert(position);
        assert(Number(position[1]) >= 19);
        assert(Math.abs(Number(position[1]) + width - 593) < 1e-6);
        assert(baseline >= 74 && baseline + 7 <= 94);
      }
      if (index === 0)
        assert(!operators.includes(font.encodeText('ORNL/FEMA').toString().slice(1, -1)));
      if (!printsStreetlightUrl)
        assert(
          !operators.includes(
            font.encodeText('streetlight.bentheurich.com').toString().slice(1, -1),
          ),
        );
      const annotations = page.node.Annots();
      assert(annotations instanceof PDFArray);
      assert.equal(annotations.size(), 1);
      const link = document.context.lookup(annotations.get(0), PDFDict);
      assert.equal(link.lookup(PDFName.of('Subtype'), PDFName), PDFName.of('Link'));
      assert.deepEqual(link.lookup(PDFName.of('Border'), PDFArray).asArray().map(String), [
        '0',
        '0',
        '0',
      ]);
      assert.deepEqual(link.lookup(PDFName.of('Rect'), PDFArray).asArray().map(Number), [
        593 - font.widthOfTextAtSize(credits, 7),
        82,
        593,
        92,
      ]);
      const action = link.lookup(PDFName.of('A'), PDFDict);
      assert.equal(action.lookup(PDFName.of('S'), PDFName), PDFName.of('URI'));
      assert.equal(
        action.lookup(PDFName.of('URI'), PDFString).decodeText(),
        'https://streetlight.bentheurich.com/map-data.html',
      );
      assert.match(operators, /582 0 0 582 0 0 cm/);
      assert.match(operators, /1 0 0 1 15 70 cm/);
    }
  }
});

test('missing map provenance rejects the PDF before rendering an uncredited map', async () => {
  await assert.rejects(
    renderPacketPdf(
      { scope: 'newest', packets: [packet('packet-a', 'TEM-001')], mapGenerations: [] },
      {
        logo: png,
        footer: { message: '', reference: '' },
        renderMap: async () => {
          assert.fail('Map must not render without its generation');
        },
      },
    ),
    /import generation missing/,
  );
});
