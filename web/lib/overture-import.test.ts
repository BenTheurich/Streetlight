import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildImporterArguments,
  parseOvertureImportOutput,
  readImporterProcess,
} from './overture-import.ts';

const requestedCenter: [number, number] = [-117.1274, 33.5107];
const validOutput = JSON.parse(
  readFileSync(
    new URL('../importer/fixtures/import-process-contract-v12.json', import.meta.url),
    'utf8',
  ),
);

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
  assert.deepEqual(parseOvertureImportOutput(JSON.stringify(validOutput)), validOutput);
});

test('accepts the shared Python contract through the process reader', async () => {
  assert.deepEqual(
    await readImporterProcess(outputProcess(validOutput), requestedCenter, 1),
    validOutput,
  );
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
          ...validOutput.mapBuildings[0],
          fema: { ...validOutput.mapBuildings[0].fema, distanceMeters: 10.01 },
        },
      ],
    },
    {
      ...validOutput,
      mapBuildings: [{ ...validOutput.mapBuildings[0], fema: null }],
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
    quality: validOutput.quality,
  });
});

test('terminates and rejects a stalled importer process', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)']);

  await assert.rejects(readImporterProcess(child, requestedCenter, 1, 20), /import timed out/i);
  assert.equal(child.killed, true);
});
