import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  buildImporterArguments,
  parseOvertureImportOutput,
  readImporterProcess,
} from './overture-import.ts';

const requestedCenter: [number, number] = [-117.1274, 33.5107];
const validOutput = {
  release: '2026-06-17.0',
  center: requestedCenter,
  radiusMiles: 1,
  completedAt: '2026-07-27T12:00:00.000Z',
  normalizerVersion: 12,
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
  apartmentSites: [
    {
      id: 'overture-apartment-area:area-1',
      sourceId: 'area-1',
      name: 'Sample Apartments',
      address: '10 Main Street, Temecula, 92591',
      position: [-117.129, 33.5101],
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [-117.13, 33.51],
            [-117.128, 33.51],
            [-117.128, 33.512],
            [-117.13, 33.51],
          ],
        ],
      },
      groupingKind: 'source_boundary',
      members: [
        {
          id: 'overture-apartment-building:building-1',
          sourceId: 'building-1',
          address: '10 Main Street, Temecula, 92591',
          position: [-117.129, 33.5101],
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
          apartmentBuilding: true,
          distinctUnits: 24,
        },
        {
          id: 'overture-apartment-address:main-st|12|92591',
          sourceId: 'main-st|12|92591',
          address: '12 Main Street, Temecula, 92591',
          position: [-117.1288, 33.5102],
          geometry: null,
          apartmentBuilding: false,
          distinctUnits: 6,
        },
      ],
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

const validImportedOutput = validOutput;

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

test('accepts the complete pinned import contract', () => {
  assert.deepEqual(parseOvertureImportOutput(JSON.stringify(validOutput)), validImportedOutput);
});

test('rejects malformed apartment sites and legacy complex payloads', () => {
  const site = validOutput.apartmentSites[0];
  const member = site.members[0];
  const duplicateMember = { ...site.members[1], id: member.id };
  const { apartmentSites: _apartmentSites, ...withoutSites } = validOutput;

  for (const value of [
    { ...withoutSites, apartmentComplexes: [] },
    { ...validOutput, apartmentSites: [{ ...site, members: [] }] },
    { ...validOutput, apartmentSites: [{ ...site, groupingKind: 'clustered' }] },
    { ...validOutput, apartmentSites: [{ ...site, members: [member, duplicateMember] }] },
    {
      ...validOutput,
      apartmentSites: [
        {
          ...site,
          members: [{ ...member, geometry: { type: 'Point', coordinates: member.position } }],
        },
      ],
    },
    { ...validOutput, apartmentSites: [{ ...site, extra: true }] },
  ]) {
    assert.throws(() => parseOvertureImportOutput(JSON.stringify(value)), /import output/i);
  }
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

test('reports coarse importer stages without mixing them into the final payload', async () => {
  const stages: string[] = [];
  const child = spawn(process.execPath, [
    '-e',
    `process.stderr.write('STREETLIGHT_STAGE:downloading_buildings\\nSTREETLIGHT_STAGE:matching\\n'); process.stdout.write(${JSON.stringify(
      JSON.stringify(validOutput),
    )})`,
  ]);

  await readImporterProcess(child, requestedCenter, 1, 1_000, (stage) => stages.push(stage));

  assert.deepEqual(stages, ['downloading_buildings', 'matching']);
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
