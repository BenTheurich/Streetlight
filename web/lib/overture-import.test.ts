import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  buildImporterArguments,
  parseOvertureImportOutput,
  readImporterProcess,
} from './overture-import.ts';

const validOutput = {
  release: '2026-07-22.0',
  center: [-117.1274, 33.5107],
  radiusMiles: 1,
  completedAt: '2026-07-27T12:00:00.000Z',
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

test('rejects malformed JSON and every invalid import field', () => {
  assert.throws(() => parseOvertureImportOutput('not json'), /import output/i);

  const invalidValues: unknown[] = [
    { ...validOutput, release: 'wrong' },
    { ...validOutput, center: [Number.NaN, 33.5107] },
    { ...validOutput, center: [-181, 33.5107] },
    { ...validOutput, radiusMiles: 0 },
    { ...validOutput, completedAt: 'yesterday' },
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
  ];

  for (const value of invalidValues) {
    assert.throws(() => parseOvertureImportOutput(JSON.stringify(value)), /import output/i);
  }
});

test('reports a real importer process failure with stderr', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.stderr.write('download failed'); process.exit(7)",
  ]);

  await assert.rejects(readImporterProcess(child), /download failed/);
});

test('rejects invalid JSON from a successful real importer process', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('not json')"]);

  await assert.rejects(readImporterProcess(child), /import output/i);
});
