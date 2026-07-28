import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CoverageClass } from './coverage.ts';
import {
  generatePacketProposals,
  type PacketSelectionSegment,
  parsePacketSizeRequests,
} from './packet-selection.ts';
import type { LineString, Position } from './territory-geometry.ts';

function segment(
  id: string,
  start: Position,
  end: Position,
  estimatedHomes: number,
  coverageClass: CoverageClass,
  options: Partial<PacketSelectionSegment> = {},
): PacketSelectionSegment {
  return {
    id,
    streetName: id,
    geometry: { type: 'LineString', coordinates: [start, end] },
    estimatedHomes,
    eligible: true,
    reserved: false,
    coverageClass,
    addresses: [
      {
        number: '1',
        street: id,
        locality: 'Temecula',
        postcode: '92591',
        position: start,
      },
    ],
    ...options,
  };
}

function endpointKey(position: Position): string {
  return `${position[0].toFixed(7)},${position[1].toFixed(7)}`;
}

function connected(segments: Array<{ geometry: LineString }>): boolean {
  if (segments.length < 2) return true;
  const visited = new Set([0]);
  while (true) {
    const before = visited.size;
    for (const selected of [...visited]) {
      const selectedEndpoints = new Set([
        endpointKey(segments[selected].geometry.coordinates[0]),
        endpointKey(segments[selected].geometry.coordinates.at(-1) as Position),
      ]);
      for (const [index, candidate] of segments.entries()) {
        if (
          !visited.has(index) &&
          [
            candidate.geometry.coordinates[0],
            candidate.geometry.coordinates.at(-1) as Position,
          ].some((point) => selectedEndpoints.has(endpointKey(point)))
        ) {
          visited.add(index);
        }
      }
    }
    if (visited.size === segments.length) return true;
    if (visited.size === before) return false;
  }
}

test('packet-size requests accept only exact positive safe-integer rows', () => {
  const valid = [
    { quantity: 2, targetHomes: 15 },
    { quantity: 1, targetHomes: 30 },
  ];
  assert.deepEqual(parsePacketSizeRequests(valid), valid);

  for (const invalid of [
    null,
    {},
    [],
    [{ quantity: 0, targetHomes: 30 }],
    [{ quantity: 1, targetHomes: -1 }],
    [{ quantity: 1.5, targetHomes: 30 }],
    [{ quantity: '1', targetHomes: 30 }],
    [{ quantity: 1, targetHomes: Number.MAX_SAFE_INTEGER + 1 }],
    [{ quantity: 1, targetHomes: 30, extra: true }],
  ]) {
    assert.throws(() => parsePacketSizeRequests(invalid), /Invalid packet request/);
  }
});

test('proposals prioritize old ranges, expand outward, match mixed sizes, and never duplicate', () => {
  const segments = [
    segment('near-a', [0, 0], [0.001, 0], 8, 'red'),
    segment('near-b', [0.001, 0], [0.002, 0], 16, 'red'),
    segment('far-culdesac', [0.02, 0], [0.021, 0], 7, 'red'),
    segment('orange-a', [0.03, 0], [0.031, 0], 7, 'orange'),
    segment('orange-b', [0.031, 0], [0.032, 0], 8, 'orange'),
    segment('newer-neighbor', [0.021, 0], [0.022, 0], 10, 'green'),
    segment('excluded', [0.04, 0], [0.041, 0], 20, 'red', { eligible: false }),
    segment('reserved', [0.05, 0], [0.051, 0], 20, 'red', { reserved: true }),
  ];
  const input = {
    center: [0, 0] as Position,
    requests: [
      { quantity: 1, targetHomes: 30 },
      { quantity: 2, targetHomes: 15 },
    ],
    segments,
  };

  const result = generatePacketProposals(input);
  assert.deepEqual(
    result.proposals.map((proposal) => proposal.coverageClass),
    ['red', 'red', 'orange'],
  );
  assert.deepEqual(
    result.proposals.map((proposal) => proposal.segments.map(({ id }) => id)),
    [['near-a', 'near-b'], ['far-culdesac'], ['orange-a', 'orange-b']],
  );
  const selectedIds = result.proposals.flatMap((proposal) => proposal.segments.map(({ id }) => id));
  assert.equal(new Set(selectedIds).size, selectedIds.length);
  assert.ok(
    result.proposals.every(
      (proposal) =>
        proposal.estimatedHomes ===
        proposal.segments.reduce((sum, selected) => sum + selected.estimatedHomes, 0),
    ),
  );
  assert.ok(result.proposals.every((proposal) => connected(proposal.segments)));
  assert.deepEqual(generatePacketProposals(input), result);
});

test('packet tolerance keeps connected exceptions whole and terminates on zero estimates', () => {
  const normal = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 30 }],
    segments: [
      segment('normal-a', [0, 0], [0.001, 0], 12, 'red'),
      segment('normal-b', [0.001, 0], [0.002, 0], 16, 'red'),
    ],
  }).proposals[0];
  assert.ok(normal.estimatedHomes >= 24 && normal.estimatedHomes <= 36);

  const oversized = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 30 }],
    segments: [segment('oversized', [0, 0], [0.001, 0], 50, 'red')],
  }).proposals[0];
  assert.equal(oversized.estimatedHomes, 50);

  const zero = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 2, targetHomes: 5 }],
    segments: [
      segment('zero-a', [0, 0], [0.001, 0], 0, 'red'),
      segment('zero-b', [0.001, 0], [0.002, 0], 0, 'red'),
    ],
  });
  assert.equal(new Set(zero.proposals.flatMap((proposal) => proposal.segments)).size, 2);
});

test('starting address prefers terminal north-side outer ends, then falls back inside', () => {
  const northOuter = {
    number: '20',
    street: 'Choice Road',
    locality: 'Temecula',
    postcode: '92591',
    position: [0.002, 0.0001] as Position,
  };
  const selected = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 10 }],
    segments: [
      segment('choice', [0, 0], [0.002, 0], 10, 'red', {
        streetName: 'Choice Road',
        addresses: [{ ...northOuter, number: '10', position: [0, -0.0001] }, northOuter],
      }),
    ],
  }).proposals[0];
  assert.equal(selected.start.address, '20 Choice Road, Temecula 92591');

  const fallback = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 10 }],
    segments: [
      segment('terminal-a', [0, 0], [0.001, 0], 3, 'red', {
        addresses: [{ ...northOuter, number: null, street: 'Terminal Road' }],
      }),
      segment('inside', [0.001, 0], [0.002, 0], 4, 'red', {
        addresses: [{ ...northOuter, number: '30', street: 'Inside Road', position: [0.001, 0] }],
      }),
      segment('terminal-b', [0.002, 0], [0.003, 0], 3, 'red', {
        addresses: [{ ...northOuter, number: null, street: 'Terminal Road' }],
      }),
    ],
  }).proposals[0];
  assert.equal(fallback.start.address, '30 Inside Road, Temecula 92591');
});

test('components without a numbered address are skipped with stable warnings', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 2, targetHomes: 10 }],
    segments: [
      segment('unusable', [0, 0], [0.001, 0], 10, 'red', {
        addresses: [
          {
            number: null,
            street: 'Unusable Road',
            locality: null,
            postcode: null,
            position: [0, 0],
          },
        ],
      }),
      segment('also-unusable', [0.01, 0], [0.011, 0], 10, 'red', {
        addresses: [],
      }),
    ],
  });
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.warnings, [
    'Skipped a connected area because no usable starting address was available.',
    'Generated fewer packets because no more eligible streets were available.',
  ]);
});

test('saved Temecula geometry produces connected deterministic mixed-size proposals', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../db/fixtures/temecula-segments.json', import.meta.url), 'utf8'),
  ) as {
    segments: Array<{
      id: string;
      street_name: string;
      estimated_homes: number;
      geometry: LineString;
    }>;
  };
  const input = {
    center: [-117.116885, 33.54293] as Position,
    requests: [
      { quantity: 2, targetHomes: 15 },
      { quantity: 1, targetHomes: 30 },
    ],
    segments: fixture.segments.map(
      (saved, index): PacketSelectionSegment => ({
        id: saved.id,
        streetName: saved.street_name,
        geometry: saved.geometry,
        estimatedHomes: saved.estimated_homes,
        eligible: true,
        reserved: false,
        coverageClass: 'red',
        addresses: [
          {
            number: String(index + 1),
            street: saved.street_name,
            locality: 'Temecula',
            postcode: '92591',
            position: saved.geometry.coordinates[0],
          },
        ],
      }),
    ),
  };
  const first = generatePacketProposals(input);
  const second = generatePacketProposals(input);

  assert.equal(first.proposals.length, 3);
  assert.ok(first.proposals.every((proposal) => connected(proposal.segments)));
  const selected = first.proposals.flatMap((proposal) => proposal.segments.map(({ id }) => id));
  assert.equal(new Set(selected).size, selected.length);
  assert.deepEqual(second, first);
});
