import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapLabData } from './database.ts';
import {
  buildOpenLabStyle,
  buildOpenMapStyle,
  packetMapView,
  packetRouteFeatures,
  packetStartDisplay,
  roadWidthAtZoom,
} from './open-map-style.ts';
import type { DownloadPacket, PacketMapGeneration } from './packet-finalization.ts';
import type { LineString } from './territory-geometry.ts';

function packet(): DownloadPacket {
  return {
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
  };
}

function mapGeneration(): PacketMapGeneration {
  return {
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
      {
        id: 'continuation',
        streetName: 'Cross Street',
        roadClass: 'residential',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0.001, -0.001],
            [0.001, 0.001],
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
    houseNumbers: [],
  };
}

test('road widths use the approved class and zoom curves', () => {
  assert.equal(roadWidthAtZoom('residential', 14), 8);
  assert.equal(roadWidthAtZoom('service', 18), 12);
  assert.equal(roadWidthAtZoom('motorway', 20), 52);
  assert.equal(roadWidthAtZoom('unknown', 14), 8);
  assert(roadWidthAtZoom('residential', 16) > 8);
  assert(roadWidthAtZoom('residential', 16) < 31);
});

test('packet view derives zoom from complete geometry instead of road names', () => {
  const short = packetMapView(packet());
  const longPacket = packet();
  longPacket.segments[0].geometry.coordinates[1] = [0.1, 0];
  const long = packetMapView(longPacket);

  assert(short.zoom > long.zoom);
  assert(Math.abs(long.zoom - 12.872674880270605) < 1e-12);
  assert.equal(Number.isInteger(long.zoom), false);
  assert(Math.abs(short.center[0] - 0.0005) < 1e-12);
  assert.equal(short.center[1], 0);
});

test('packet view includes the optimized starting-house position', () => {
  const view = packetMapView(packet(), [0.002, 0]);

  assert(Math.abs(view.center[0] - 0.001) < 1e-12);
  assert(view.zoom < 19);
});

test('route trimming is topology-aware and leaves a real network end rounded', () => {
  const value = packet();
  const source = value.segments[0].geometry.coordinates;
  const features = packetRouteFeatures(value, mapGeneration(), 18);
  const coordinates = features[0].geometry.coordinates;

  assert.deepEqual(features[0].properties, {
    streetName: 'Main Street',
    roadClass: 'residential',
    startTreatment: 'network_end',
    endTreatment: 'network_continuation',
  });
  assert.deepEqual(coordinates[0], source[0]);
  const coordinateEnd = coordinates.at(-1);
  const sourceEnd = source.at(-1);
  assert(coordinateEnd && sourceEnd);
  assert(coordinateEnd[0] < sourceEnd[0]);
  assert.deepEqual(source, [
    [0, 0],
    [0.001, 0],
  ]);
});

test('style inserts only real buildings and a route with the same width expression', () => {
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line', paint: {} },
      { id: 'highway-name-minor', type: 'symbol', layout: {}, paint: {} },
    ],
  };
  const style = buildOpenMapStyle(base, packet(), mapGeneration(), 18);
  const buildingSource = style.sources.streetlightBuildings as {
    data: { features: unknown[] };
  };
  const routeLayer = style.layers.find(({ id }) => id === 'streetlight-route');
  const routeLabels = style.layers.find(({ id }) => id === 'streetlight-route-labels');
  const baseLabels = style.layers.find(({ id }) => id === 'highway-name-minor');

  assert.equal(buildingSource.data.features.length, 1);
  assert.equal(
    style.layers.findIndex(({ id }) => id === 'streetlight-buildings'),
    0,
  );
  assert.deepEqual(routeLayer?.layout, { 'line-cap': 'round', 'line-join': 'round' });
  assert.deepEqual(routeLabels?.layout, {
    'symbol-placement': 'line-center',
    'text-field': ['get', 'streetName'],
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 14, 13, 18, 17],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-keep-upright': true,
  });
  assert.deepEqual(routeLabels?.paint, {
    'text-color': '#ffffff',
    'text-halo-color': '#716863',
    'text-halo-width': 1.5,
  });
  assert.deepEqual(baseLabels?.filter, [
    '!',
    ['in', ['coalesce', ['get', 'name_en'], ['get', 'name']], ['literal', ['Main Street']]],
  ]);
  assert.deepEqual(routeLayer?.paint?.['line-width'], [
    'interpolate',
    ['exponential', 1.4],
    ['zoom'],
    14,
    [
      'match',
      ['get', 'roadClass'],
      ['residential', 'living_street', 'unclassified'],
      8,
      'service',
      3,
      'track',
      2,
      ['primary', 'secondary', 'tertiary', 'trunk'],
      11,
      'motorway',
      13,
      8,
    ],
    18,
    [
      'match',
      ['get', 'roadClass'],
      ['residential', 'living_street', 'unclassified'],
      31,
      'service',
      12,
      'track',
      8,
      ['primary', 'secondary', 'tertiary', 'trunk'],
      39,
      'motorway',
      40,
      31,
    ],
    20,
    [
      'match',
      ['get', 'roadClass'],
      ['residential', 'living_street', 'unclassified'],
      42,
      'service',
      18,
      'track',
      12,
      ['primary', 'secondary', 'tertiary', 'trunk'],
      52,
      'motorway',
      52,
      42,
    ],
  ]);
});

test('packet style labels one longest straight route run for each street', () => {
  const value = packet();
  value.segments.push({
    ...value.segments[0],
    id: 'short-main',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.002, 0],
        [0.0021, 0],
      ],
    },
  });
  value.segments.push({
    ...value.segments[0],
    id: 'bent-road',
    streetName: 'Bent Road',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.01, 0],
        [0.01, 0.002],
        [0.011, 0.002],
      ],
    },
  });
  const style = buildOpenMapStyle(
    { version: 8, sources: {}, layers: [{ id: 'highway-name-minor', type: 'symbol' }] },
    value,
    mapGeneration(),
    18,
  );
  const source = style.sources.streetlightRouteLabels as {
    data: { features: Array<{ geometry: LineString }> };
  };

  assert.equal(source.data.features.length, 2);
  assert.deepEqual(source.data.features[0].geometry.coordinates[0], [0, 0]);
  assert((source.data.features[0].geometry.coordinates.at(-1)?.[0] ?? 0) > 0.0008);
  assert.deepEqual(source.data.features[1].geometry.coordinates, [
    [0.01, 0],
    [0.01, 0.002],
  ]);
  assert.equal(
    style.layers.find(({ id }) => id === 'streetlight-route-labels')?.source,
    'streetlightRouteLabels',
  );
});

test('packet starting pin reuses the safe building-centered house-number position', () => {
  const value = packet();
  value.start = { address: '1 Main Street', position: [0.00013, 0.00005] };
  const generation = mapGeneration();
  generation.houseNumbers = [{ number: '1', street: 'Main Street', position: [0.00013, 0.00005] }];

  const display = packetStartDisplay(value, generation);

  assert.equal(display.number, '1');
  assert(Math.abs(display.position[0] - 0.00005) < 1e-12);
  assert(Math.abs(display.position[1] - 0.00005) < 1e-12);
});

function mapLabData(): MapLabData {
  return {
    churchId: 'church',
    territoryId: 'territory',
    territoryName: 'Territory',
    center: [0, 0],
    bounds: [-1, -1, 1, 1],
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, -1],
        ],
      ],
    },
    importGeneration: 1,
    overtureRelease: '2026-06-17.0',
    buildingMode: 'overture_only',
    segments: [
      {
        id: 'one',
        streetName: 'Main Street',
        roadClass: 'residential',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.001, 0],
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
    apartmentComplexes: [],
    buildings: mapGeneration().buildings,
    houseNumbers: [
      { number: '31308', street: 'Amberley Circle', position: [0.00002, 0.00003] },
      { number: '31310', street: 'Amberley Circle', position: [0.0002, 0.0002] },
    ],
    attribution: {
      base: 'OpenFreeMap © OpenMapTiles',
      roads: 'Data from OpenStreetMap',
      buildings: 'Overture Maps',
      fema: null,
    },
  };
}

test('map lab keeps real buildings and uses the interactive coverage stroke scale', () => {
  const data = mapLabData();
  const base = {
    version: 8,
    glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      {
        id: 'highway-name-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
      },
      {
        id: 'highway-name-major',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
      },
      { id: 'place-name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ],
  };

  const map = buildOpenLabStyle(base, data);
  const satellite = buildOpenLabStyle(base, data, true);
  assert.ok(map.layers.some(({ id }) => id === 'streetlight-buildings'));
  assert.ok(map.layers.some(({ id }) => id === 'streetlight-coverage'));
  assert.equal(
    satellite.layers.some(({ id }) => id === 'streetlight-buildings'),
    false,
  );
  assert.ok(satellite.layers.some(({ id }) => id === 'streetlight-coverage'));
  assert.equal(satellite.glyphs, base.glyphs);
  assert.deepEqual(satellite.sources.openmaptiles, base.sources.openmaptiles);
  assert.deepEqual(
    satellite.layers.filter(({ type }) => type === 'symbol').map(({ id }) => id),
    ['streetlight-apartment-labels', 'highway-name-minor', 'highway-name-major'],
  );
  assert.ok(
    satellite.layers.findIndex(({ id }) => id === 'streetlight-coverage') <
      satellite.layers.findIndex(({ id }) => id === 'highway-name-minor'),
  );
  assert.deepEqual(
    map.layers.find(({ id }) => id === 'streetlight-coverage')?.paint?.['line-width'],
    ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5],
  );
});

test('map lab presents an accepted FEMA row gap as an ordinary building without audit layers', () => {
  const data = mapLabData();
  data.buildings.push({
    source: 'fema',
    sourceId: 'accepted-gap',
    geometry: data.buildings[0].geometry,
    fema: null,
    address: { number: '31299', street: 'Canterbury Ct' },
  });
  const base = {
    version: 8,
    glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      { id: 'highway-name-minor', type: 'symbol' },
      { id: 'highway-name-major', type: 'symbol' },
    ],
  };

  const style = buildOpenLabStyle(base, data);
  const source = style.sources.streetlightBuildings as {
    data: { features: Array<{ properties: { source: string; sourceId: string } }> };
  };

  assert.ok(
    source.data.features.some(
      ({ properties }) => properties.source === 'fema' && properties.sourceId === 'accepted-gap',
    ),
  );
  assert.equal('streetlightFemaAudit' in style.sources, false);
  assert.equal(
    style.layers.some(({ id }) => id.includes('fema-audit')),
    false,
  );
});

test('map lab tapers gray roads at territory zoom without changing the print basemap', () => {
  const minorAt14 = ['match', ['get', 'class'], 'minor', 8, 'service', 3, 'track', 2, 8];
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      {
        id: 'highway_path',
        type: 'line',
        paint: {
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 14, 2, 18, 6],
        },
      },
      {
        id: 'highway_minor',
        type: 'line',
        paint: {
          'line-width': [
            'interpolate',
            ['exponential', 1.4],
            ['zoom'],
            14,
            minorAt14,
            18,
            minorAt14,
          ],
        },
      },
      {
        id: 'highway_major_inner',
        type: 'line',
        paint: {
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 14, 11, 18, 39],
        },
      },
      {
        id: 'highway_motorway_inner',
        type: 'line',
        paint: {
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 14, 13, 18, 40],
        },
      },
      { id: 'highway-name-minor', type: 'symbol' },
    ],
  };

  const map = buildOpenLabStyle(base, mapLabData());
  const print = buildOpenMapStyle(base, packet(), mapGeneration(), 18);

  assert.deepEqual(map.layers.find(({ id }) => id === 'highway_path')?.paint?.['line-width'], [
    'interpolate',
    ['exponential', 1.4],
    ['zoom'],
    11,
    0.5,
    13,
    1,
    14,
    2,
    18,
    6,
  ]);
  assert.deepEqual(map.layers.find(({ id }) => id === 'highway_minor')?.paint?.['line-width'], [
    'interpolate',
    ['exponential', 1.4],
    ['zoom'],
    11,
    ['match', ['get', 'class'], 'minor', 1, 'service', 0.5, 'track', 0.35, 1],
    13,
    ['match', ['get', 'class'], 'minor', 4, 'service', 1.5, 'track', 1, 4],
    14,
    minorAt14,
    18,
    minorAt14,
  ]);
  assert.deepEqual(
    map.layers.find(({ id }) => id === 'highway_major_inner')?.paint?.['line-width'],
    ['interpolate', ['exponential', 1.4], ['zoom'], 11, 2.5, 13, 6, 14, 11, 18, 39],
  );
  assert.deepEqual(
    map.layers.find(({ id }) => id === 'highway_motorway_inner')?.paint?.['line-width'],
    ['interpolate', ['exponential', 1.4], ['zoom'], 11, 4, 13, 8, 14, 13, 18, 40],
  );
  assert.deepEqual(
    print.layers.find(({ id }) => id === 'highway_minor')?.paint?.['line-width'],
    base.layers.find(({ id }) => id === 'highway_minor')?.paint?.['line-width'],
  );
});

test('map lab waits until neighborhood zoom to show building footprints', () => {
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      { id: 'highway-name-minor', type: 'symbol' },
    ],
  };

  const map = buildOpenLabStyle(base, mapLabData());
  const print = buildOpenMapStyle(base, packet(), mapGeneration(), 18);

  assert.equal(map.layers.find(({ id }) => id === 'streetlight-buildings')?.minzoom, 16);
  assert.equal(print.layers.find(({ id }) => id === 'streetlight-buildings')?.minzoom, undefined);
});

test('map lab centers one-address building labels and preserves unmatched positions', () => {
  const base = {
    version: 8,
    glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      { id: 'highway-name-minor', type: 'symbol' },
    ],
  };

  const map = buildOpenLabStyle(base, mapLabData());
  const satellite = buildOpenLabStyle(base, mapLabData(), true);
  const source = map.sources.streetlightHouseNumbers as {
    data: { features: unknown[] };
  };
  const layer = map.layers.find(({ id }) => id === 'streetlight-house-numbers');

  const features = source.data.features as Array<{
    geometry: { coordinates: [number, number] };
    properties: { number: string };
  }>;
  assert.equal(features[0].properties.number, '31308');
  assert(Math.abs(features[0].geometry.coordinates[0] - 0.00005) < 1e-12);
  assert(Math.abs(features[0].geometry.coordinates[1] - 0.00005) < 1e-12);
  assert.deepEqual(features[1], {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0.0002, 0.0002] },
    properties: { number: '31310' },
  });
  assert.equal(layer?.minzoom, 18);
  assert.deepEqual(layer?.layout, {
    'text-field': ['get', 'number'],
    'text-size': 10,
    'text-font': ['Noto Sans Bold'],
    'text-allow-overlap': false,
  });
  assert.equal('streetlightHouseNumbers' in satellite.sources, false);
  assert.equal(
    satellite.layers.some(({ id }) => id === 'streetlight-house-numbers'),
    false,
  );
});

test('map lab centers a nearby address only when one building wins by three meters', () => {
  const data = mapLabData();
  data.houseNumbers = [
    { number: '31308', street: 'Amberley Circle', position: [0.00013, 0.00005] },
  ];
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      { id: 'highway-name-minor', type: 'symbol' },
    ],
  };
  const centered = buildOpenLabStyle(base, data);
  const centeredSource = centered.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  assert(Math.abs(centeredSource.data.features[0].geometry.coordinates[0] - 0.00005) < 1e-12);
  assert(Math.abs(centeredSource.data.features[0].geometry.coordinates[1] - 0.00005) < 1e-12);

  data.buildings.push({
    ...data.buildings[0],
    sourceId: 'building-two',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0.00018, 0],
          [0.00028, 0],
          [0.00028, 0.0001],
          [0.00018, 0.0001],
          [0.00018, 0],
        ],
      ],
    },
  });
  const ambiguous = buildOpenLabStyle(base, data);
  const ambiguousSource = ambiguous.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  assert.deepEqual(ambiguousSource.data.features[0].geometry.coordinates, [0.00013, 0.00005]);
});

test('map lab centers a same-street address row with one unique nearest building per number', () => {
  const data = mapLabData();
  data.buildings.push(
    {
      ...data.buildings[0],
      sourceId: 'building-two',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.00015, 0],
            [0.00025, 0],
            [0.00025, 0.0001],
            [0.00015, 0.0001],
            [0.00015, 0],
          ],
        ],
      },
    },
    {
      ...data.buildings[0],
      sourceId: 'building-three',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.0003, 0],
            [0.0004, 0],
            [0.0004, 0.0001],
            [0.0003, 0.0001],
            [0.0003, 0],
          ],
        ],
      },
    },
  );
  data.houseNumbers = [
    { number: '100', street: 'Row Road', position: [0.00012, 0.00005] },
    { number: '102', street: 'Row Road', position: [0.00027, 0.00005] },
    { number: '104', street: 'Row Road', position: [0.00042, 0.00005] },
  ] as MapLabData['houseNumbers'];
  const map = buildOpenLabStyle(
    {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'highway_path', type: 'line' },
        { id: 'highway-name-minor', type: 'symbol' },
      ],
    },
    data,
  );
  const source = map.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  const expected = [
    [0.00005, 0.00005],
    [0.0002, 0.00005],
    [0.00035, 0.00005],
  ];
  source.data.features.forEach(({ geometry }, index) => {
    assert(Math.abs(geometry.coordinates[0] - expected[index][0]) < 1e-12);
    assert(Math.abs(geometry.coordinates[1] - expected[index][1]) < 1e-12);
  });
});

test('map lab leaves multiple addresses in one building at their real positions', () => {
  const data = mapLabData();
  data.houseNumbers = [
    { number: '31308', street: 'Amberley Circle', position: [0.00002, 0.00003] },
    { number: '31310', street: 'Amberley Circle', position: [0.00008, 0.00007] },
  ];
  const map = buildOpenLabStyle(
    {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'highway_path', type: 'line' },
        { id: 'highway-name-minor', type: 'symbol' },
      ],
    },
    data,
  );
  const source = map.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  assert.deepEqual(
    source.data.features.map(({ geometry }) => geometry.coordinates),
    [
      [0.00002, 0.00003],
      [0.00008, 0.00007],
    ],
  );
});

test('map lab centers the uniquely matched FEMA fallback label', () => {
  const data = mapLabData();
  data.buildings = [
    {
      ...data.buildings[0],
      source: 'fema',
      fema: {
        addressSourceId: 'address-one',
        distanceMeters: 1.002,
        occupancy: 'Single Family Dwelling',
        outbuilding: false,
        source: null,
        productDate: null,
        imageDate: null,
      },
    },
  ];
  data.houseNumbers = [
    { number: '31308', street: 'Amberley Circle', position: [0.000109, 0.00005] },
    { number: '31310', street: 'Amberley Circle', position: [0.00002, 0.00002] },
  ];
  const map = buildOpenLabStyle(
    {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'highway_path', type: 'line' },
        { id: 'highway-name-minor', type: 'symbol' },
      ],
    },
    data,
  );
  const source = map.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  assert(Math.abs(source.data.features[0].geometry.coordinates[0] - 0.00005) < 1e-12);
  assert(Math.abs(source.data.features[0].geometry.coordinates[1] - 0.00005) < 1e-12);
  assert.deepEqual(source.data.features[1].geometry.coordinates, [0.00002, 0.00002]);
});

test('map lab centers the approved FEMA row-gap address on its building', () => {
  const data = mapLabData();
  data.buildings = [
    {
      ...data.buildings[0],
      source: 'fema',
      fema: null,
      address: { number: '31308', street: 'Amberley Circle' },
    },
  ];
  data.houseNumbers = [
    { number: '31308', street: 'Amberley Circle', position: [0.000109, 0.00005] },
  ];
  const map = buildOpenLabStyle(
    {
      version: 8,
      sources: { openmaptiles: { type: 'vector' } },
      layers: [
        { id: 'highway_path', type: 'line' },
        { id: 'highway-name-minor', type: 'symbol' },
      ],
    },
    data,
  );
  const source = map.sources.streetlightHouseNumbers as {
    data: { features: Array<{ geometry: { coordinates: [number, number] } }> };
  };

  assert(Math.abs(source.data.features[0].geometry.coordinates[0] - 0.00005) < 1e-12);
  assert(Math.abs(source.data.features[0].geometry.coordinates[1] - 0.00005) < 1e-12);
});
