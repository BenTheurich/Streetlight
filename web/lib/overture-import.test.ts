import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import type { ImportedTerritoryInput } from './overture-import.ts';
import {
  buildImporterArguments,
  mergeImportedTerritories,
  parseOvertureImportOutput,
  readImporterProcess,
} from './overture-import.ts';

const requestedCenter: [number, number] = [-117.1274, 33.5107];
const validOutput = {
  release: '2026-06-17.0',
  center: requestedCenter,
  radiusMiles: 1,
  completedAt: '2026-07-27T12:00:00.000Z',
  normalizerVersion: 10,
  buildingMode: 'overture_fema',
  mapBuildings: [
    {
      source: 'overture',
      sourceId: 'building-1',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-117.1291, 33.5101],
            [-117.129, 33.5101],
            [-117.129, 33.5102],
            [-117.1291, 33.5101],
          ],
        ],
      },
      fema: null,
    },
    {
      source: 'fema',
      sourceId: 'fema-1',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-117.1281, 33.5101],
            [-117.128, 33.5101],
            [-117.128, 33.5102],
            [-117.1281, 33.5101],
          ],
        ],
      },
      fema: {
        addressSourceId: 'address-1',
        distanceMeters: 4.2,
        occupancy: 'Single Family Dwelling',
        outbuilding: false,
        source: 'FEMA',
        productDate: '2025-01-02T00:00:00.000Z',
        imageDate: null,
      },
    },
  ],
  quality: {
    totalAddresses: 12,
    assignedAddresses: 10,
    spatiallyAssignedAddresses: 3,
    inferredRoads: 1,
    unmatchedAddresses: 2,
    unresolvedClusters: 2,
    totalResidentialBuildings: 9,
    fallbackBuildings: 2,
    unmatchedResidentialBuildings: 1,
    populatedUnnamedRoads: 0,
    buildingAddressDisagreements: 1,
    warnings: ['Address matching is below the 95% reliability target (83.3% matched).'],
  },
  apartmentComplexes: [
    {
      id: 'overture-apartment-building:building-1',
      sourceId: 'building-1',
      address: '10 Main Street, Temecula, 92591',
      position: [-117.129, 33.5101],
      estimatedTracts: 24,
      evidence: {
        apartmentBuilding: true,
        distinctUnits: 24,
      },
    },
  ],
  segments: [
    {
      id: 'overture:road-1:0',
      sourceSegmentId: 'road-1',
      roadGroupId: 'road-group:overture:road-1:0',
      roadClass: 'residential',
      streetName: 'Main Street',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.13, 33.51],
          [-117.12, 33.51],
        ],
      },
      estimatedHomes: 4,
      addresses: [
        {
          number: '10',
          street: 'Main Street',
          locality: 'Temecula',
          postcode: '92591',
          position: [-117.129, 33.5101],
        },
        {
          number: null,
          street: 'Main Street',
          locality: null,
          postcode: null,
          position: [-117.121, 33.5101],
        },
      ],
      activationKind: 'automatic',
    },
  ],
};

const validImportedOutput = validOutput as ImportedTerritoryInput;

function outputProcess(value: unknown) {
  return spawn(process.execPath, [
    '-e',
    `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`,
  ]);
}

test('builds stable importer arguments', () => {
  assert.deepEqual(buildImporterArguments([-117.1274, 33.5107], 1), [
    '--longitude',
    '-117.1274',
    '--latitude',
    '33.5107',
    '--radius-miles',
    '1',
  ]);
});

test('rejects invalid importer arguments before starting Python', () => {
  assert.throws(() => buildImporterArguments([Number.NaN, 33.5107], 1), /center/i);
  assert.throws(() => buildImporterArguments([-117.1274, 33.5107], 0), /radius/i);
});

test('builds explicit bounds importer arguments without replacing target metadata', () => {
  assert.deepEqual(
    buildImporterArguments(requestedCenter, 2, {
      west: -117.2,
      south: 33.4,
      east: -117.1,
      north: 33.5,
    }),
    [
      '--longitude',
      '-117.1274',
      '--latitude',
      '33.5107',
      '--radius-miles',
      '2',
      '--bounds',
      '-117.2',
      '33.4',
      '-117.1',
      '33.5',
    ],
  );
});

test('merges normalized overlap without duplicate streets, addresses, apartments, or buildings', () => {
  const addition = structuredClone(validImportedOutput);
  addition.center = [-117.12, 33.51];
  addition.radiusMiles = 0.25;
  addition.completedAt = '2026-08-04T12:00:00.000Z';
  addition.segments[0].addresses = [
    addition.segments[0].addresses[0],
    {
      number: '12',
      street: 'Main Street',
      locality: 'Temecula',
      postcode: '92591',
      position: [-117.128, 33.5101],
    },
  ];
  addition.segments[0].estimatedHomes = 2;

  const merged = mergeImportedTerritories(validImportedOutput, [addition], requestedCenter, 2);

  assert.equal(merged.segments.length, 1);
  assert.equal(merged.segments[0].addresses.length, 3);
  assert.equal(merged.segments[0].estimatedHomes, 5);
  assert.equal(merged.apartmentComplexes.length, 1);
  assert.equal(merged.mapBuildings.length, 2);
  assert.deepEqual(merged.center, requestedCenter);
  assert.equal(merged.radiusMiles, 2);
  assert.equal(merged.completedAt, addition.completedAt);
});

test('preserves existing source-road partitions when a strip normalizes that road differently', () => {
  const current = structuredClone(validImportedOutput);
  current.segments = [
    {
      ...current.segments[0],
      roadGroupId: 'old-hidden-group',
      streetName: 'Unnamed road',
      activationKind: 'hidden',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.13, 33.51],
          [-117.125, 33.51],
        ],
      },
      addresses: [current.segments[0].addresses[0]],
      estimatedHomes: 1,
    },
    {
      ...current.segments[0],
      id: 'overture:road-1:1',
      roadGroupId: 'old-hidden-group',
      streetName: 'Unnamed road',
      activationKind: 'hidden',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-117.125, 33.51],
          [-117.12, 33.51],
        ],
      },
      addresses: [current.segments[0].addresses[1]],
      estimatedHomes: 1,
    },
  ];
  const addition = structuredClone(validImportedOutput);
  addition.segments[0].addresses = [
    {
      number: '12',
      street: 'Main Street',
      locality: 'Temecula',
      postcode: '92591',
      position: [-117.121, 33.5101],
    },
  ];
  addition.apartmentComplexes[0].estimatedTracts = 4;
  addition.apartmentComplexes[0].evidence.distinctUnits = 4;

  const merged = mergeImportedTerritories(current, [addition], requestedCenter, 2);

  assert.deepEqual(
    merged.segments.map(
      ({ id, geometry, estimatedHomes, streetName, activationKind, roadGroupId }) => ({
        id,
        geometry,
        estimatedHomes,
        streetName,
        activationKind,
        roadGroupId,
      }),
    ),
    current.segments.map(({ id, geometry }, index) => ({
      id,
      geometry,
      estimatedHomes: index === 0 ? 1 : 2,
      streetName: 'Main Street',
      activationKind: 'automatic',
      roadGroupId: validImportedOutput.segments[0].roadGroupId,
    })),
  );
  assert.equal(merged.apartmentComplexes[0].estimatedTracts, 28);
  assert.equal(merged.apartmentComplexes[0].evidence.distinctUnits, 28);
});

test('accepts the complete pinned import contract', () => {
  assert.deepEqual(parseOvertureImportOutput(JSON.stringify(validOutput)), validImportedOutput);
});

test('accepts an empty normalized result only for an incremental rectangle', () => {
  const empty = { ...validOutput, segments: [] };

  assert.throws(() => parseOvertureImportOutput(JSON.stringify(empty)), /import output/i);
  assert.deepEqual(parseOvertureImportOutput(JSON.stringify(empty), true).segments, []);
});

test('recomputes whole-region warnings instead of retaining an empty-strip warning', () => {
  const empty = structuredClone(validImportedOutput);
  empty.segments = [];
  empty.mapBuildings = [];
  empty.apartmentComplexes = [];
  empty.quality = {
    totalAddresses: 0,
    assignedAddresses: 0,
    spatiallyAssignedAddresses: 0,
    inferredRoads: 0,
    unmatchedAddresses: 0,
    unresolvedClusters: 0,
    totalResidentialBuildings: 0,
    fallbackBuildings: 0,
    unmatchedResidentialBuildings: 0,
    populatedUnnamedRoads: 0,
    buildingAddressDisagreements: 0,
    warnings: ['No usable address points were available for this territory.'],
  };

  const merged = mergeImportedTerritories(validImportedOutput, [empty], requestedCenter, 2);

  assert.equal(
    merged.quality.warnings.includes('No usable address points were available for this territory.'),
    false,
  );
});

test('adds anonymous fallback-building homes when an overlapping source expands', () => {
  const current = structuredClone(validImportedOutput);
  current.segments[0].estimatedHomes = 100;
  const addition = structuredClone(validImportedOutput);
  addition.segments[0].estimatedHomes = addition.segments[0].addresses.length + 1;

  const merged = mergeImportedTerritories(current, [addition], requestedCenter, 2);

  assert.equal(
    merged.segments.find(({ id }) => id === validImportedOutput.segments[0].id)?.estimatedHomes,
    101,
  );
});

test('rejects guessed or invalid display buildings', () => {
  for (const value of [
    { ...validOutput, buildingMode: 'automatic' },
    { ...validOutput, mapBuildings: [{ ...validOutput.mapBuildings[0], source: 'guessed' }] },
    { ...validOutput, mapBuildings: [{ ...validOutput.mapBuildings[0], sourceId: '' }] },
    {
      ...validOutput,
      mapBuildings: [
        {
          ...validOutput.mapBuildings[0],
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-181, 33],
                [-181, 34],
                [-181, 33],
              ],
            ],
          },
        },
      ],
    },
    {
      ...validOutput,
      mapBuildings: [
        {
          ...validOutput.mapBuildings[1],
          fema: { ...validOutput.mapBuildings[1].fema, distanceMeters: 10.01 },
        },
      ],
    },
    {
      ...validOutput,
      mapBuildings: [{ ...validOutput.mapBuildings[1], fema: null }],
    },
  ]) {
    assert.throws(() => parseOvertureImportOutput(JSON.stringify(value)), /import output/i);
  }
});

test('rejects malformed JSON and every invalid import field', () => {
  assert.throws(() => parseOvertureImportOutput('not json'), /import output/i);
  const address = validOutput.segments[0].addresses[0];
  const { addresses: _addresses, ...withoutAddresses } = validOutput.segments[0];

  const invalidValues: unknown[] = [
    { ...validOutput, release: 'wrong' },
    { ...validOutput, center: [Number.NaN, 33.5107] },
    { ...validOutput, center: [-181, 33.5107] },
    { ...validOutput, radiusMiles: 0 },
    { ...validOutput, completedAt: 'yesterday' },
    { ...validOutput, normalizerVersion: 1 },
    { ...validOutput, normalizerVersion: 2.5 },
    { ...validOutput, quality: { ...validOutput.quality, totalAddresses: -1 } },
    { ...validOutput, quality: { ...validOutput.quality, assignedAddresses: 10.5 } },
    { ...validOutput, quality: { ...validOutput.quality, unmatchedAddresses: 1 } },
    { ...validOutput, quality: { ...validOutput.quality, unresolvedClusters: -1 } },
    { ...validOutput, quality: { ...validOutput.quality, extra: 1 } },
    { ...validOutput, segments: [] },
    {
      ...validOutput,
      segments: [validOutput.segments[0], { ...validOutput.segments[0] }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], id: '' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], sourceSegmentId: '' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], roadClass: '' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], roadGroupId: '' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], activationKind: 'manual' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], streetName: '  ' }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], estimatedHomes: -1 }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], estimatedHomes: 1.5 }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], estimatedHomes: 101 }],
    },
    {
      ...validOutput,
      segments: [withoutAddresses],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], addresses: [{ ...address, extra: true }] }],
    },
    {
      ...validOutput,
      segments: [
        {
          ...validOutput.segments[0],
          addresses: [{ ...address, position: [-181, 33.5] }],
        },
      ],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], addresses: [{ ...address, street: '' }] }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], addresses: [{ ...address, number: 42 }] }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], addresses: [{ ...address, locality: 5 }] }],
    },
    {
      ...validOutput,
      segments: [{ ...validOutput.segments[0], addresses: [{ ...address, postcode: false }] }],
    },
    {
      ...validOutput,
      segments: [
        {
          ...validOutput.segments[0],
          geometry: { type: 'Polygon', coordinates: validOutput.segments[0].geometry.coordinates },
        },
      ],
    },
    {
      ...validOutput,
      segments: [
        {
          ...validOutput.segments[0],
          geometry: { type: 'LineString', coordinates: [[-117.13, 33.51]] },
        },
      ],
    },
    {
      ...validOutput,
      segments: [
        {
          ...validOutput.segments[0],
          geometry: {
            type: 'LineString',
            coordinates: [
              [-117.13, 33.51],
              [Number.POSITIVE_INFINITY, 33.51],
            ],
          },
        },
      ],
    },
    {
      ...validOutput,
      segments: [
        {
          ...validOutput.segments[0],
          geometry: {
            type: 'LineString',
            coordinates: [
              [-117.13, 33.51],
              [181, 91],
            ],
          },
        },
      ],
    },
  ];

  for (const value of invalidValues) {
    assert.throws(() => parseOvertureImportOutput(JSON.stringify(value)), /import output/i);
  }
});

test('rejects missing and extra import-quality fields', () => {
  const { quality: _quality, ...withoutQuality } = validOutput;
  const { normalizerVersion: _normalizerVersion, ...withoutVersion } = validOutput;

  for (const value of [
    withoutQuality,
    withoutVersion,
    { ...validOutput, extra: true },
    {
      ...validOutput,
      quality: {
        totalAddresses: 12,
        assignedAddresses: 10,
        inferredRoads: 1,
        unmatchedAddresses: 2,
      },
    },
  ]) {
    assert.throws(() => parseOvertureImportOutput(JSON.stringify(value)), /import output/i);
  }
});

test('reports a real importer process failure with stderr', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.stderr.write('download failed'); process.exit(7)",
  ]);

  await assert.rejects(readImporterProcess(child, requestedCenter, 1), /download failed/);
});

test('rejects invalid JSON from a successful real importer process', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('not json')"]);

  await assert.rejects(readImporterProcess(child, requestedCenter, 1), /import output/i);
});

test('binds successful importer output to the requested center and radius', async () => {
  await assert.rejects(
    readImporterProcess(
      outputProcess({ ...validOutput, center: [-117, 33.5107] }),
      requestedCenter,
      1,
    ),
    /import request/i,
  );
  const withinTolerance = {
    ...validOutput,
    center: [requestedCenter[0] + 5e-10, requestedCenter[1] - 5e-10],
    radiusMiles: 1 + 5e-10,
  };

  assert.deepEqual(await readImporterProcess(outputProcess(withinTolerance), requestedCenter, 1), {
    ...withinTolerance,
    quality: validImportedOutput.quality,
  });
});

test('terminates and rejects a stalled importer process', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)']);

  await assert.rejects(readImporterProcess(child, requestedCenter, 1, 20), /import timed out/i);
  assert.equal(child.killed, true);
});
