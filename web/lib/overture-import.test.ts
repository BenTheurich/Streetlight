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
  normalizerVersion: 2,
  quality: {
    totalAddresses: 12,
    assignedAddresses: 10,
    inferredRoads: 1,
    unmatchedAddresses: 2,
    unresolvedClusters: 0,
  },
  segments: [
    {
      id: 'overture:road-1:0',
      sourceSegmentId: 'road-1',
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
    },
  ],
};

const validImportedOutput = {
  ...validOutput,
  quality: {
    totalAddresses: 12,
    assignedAddresses: 10,
    inferredRoads: 1,
    unmatchedAddresses: 2,
  },
};

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

test('rejects malformed JSON and every invalid import field', () => {
  assert.throws(() => parseOvertureImportOutput('not json'), /import output/i);

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
    { ...validOutput, quality: { ...validOutput.quality, unresolvedClusters: 1 } },
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
      segments: [{ ...validOutput.segments[0], roadClass: 'motorway' }],
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
