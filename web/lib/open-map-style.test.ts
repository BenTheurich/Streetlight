import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapLabData } from './database.ts';
import {
  buildOpenLabStyle,
  buildOpenMapStyle,
  packetMapView,
  packetRouteFeatures,
  roadWidthAtZoom,
} from './open-map-style.ts';
import type { DownloadPacket, PacketMapGeneration } from './packet-finalization.ts';

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
              [0, 0],
            ],
          ],
        },
        fema: null,
      },
    ],
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
  assert(Math.abs(short.center[0] - 0.0005) < 1e-12);
  assert.equal(short.center[1], 0);
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

  assert.equal(buildingSource.data.features.length, 1);
  assert.equal(
    style.layers.findIndex(({ id }) => id === 'streetlight-buildings'),
    0,
  );
  assert.deepEqual(routeLayer?.layout, { 'line-cap': 'round', 'line-join': 'round' });
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

test('map lab keeps real buildings on the vector map and hides them over satellite', () => {
  const data: MapLabData = {
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
    attribution: {
      base: 'OpenFreeMap © OpenMapTiles',
      roads: 'Data from OpenStreetMap',
      buildings: 'Overture Maps',
      fema: null,
    },
  };
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'highway_path', type: 'line' },
      { id: 'highway-name-minor', type: 'symbol' },
    ],
  };

  const map = buildOpenLabStyle(base, data);
  const satellite = buildOpenLabStyle(base, data, true);
  const packetStyle = buildOpenMapStyle(base, packet(), mapGeneration(), 18);

  assert.ok(map.layers.some(({ id }) => id === 'streetlight-buildings'));
  assert.ok(map.layers.some(({ id }) => id === 'streetlight-coverage'));
  assert.equal(
    satellite.layers.some(({ id }) => id === 'streetlight-buildings'),
    false,
  );
  assert.ok(satellite.layers.some(({ id }) => id === 'streetlight-coverage'));
  assert.deepEqual(
    map.layers.find(({ id }) => id === 'streetlight-coverage')?.paint?.['line-width'],
    packetStyle.layers.find(({ id }) => id === 'streetlight-route')?.paint?.['line-width'],
  );
});
