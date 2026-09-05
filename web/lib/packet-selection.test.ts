import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CoverageClass } from './coverage.ts';
import {
  generatePacketProposals,
  type PacketSelectionSegment,
  parsePacketSizeRequests,
  proposalsForMap,
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
    lastCoveredOn: null,
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

test('packet map shows every proposal until one is selected', () => {
  const proposals = [
    {
      targetHomes: 10,
      estimatedHomes: 10,
      coverageClass: 'red' as const,
      segments: [],
      start: { address: 'A', position: [0, 0] as Position },
      streetNames: ['A'],
    },
    {
      targetHomes: 20,
      estimatedHomes: 20,
      coverageClass: 'orange' as const,
      segments: [],
      start: { address: 'B', position: [1, 1] as Position },
      streetNames: ['B'],
    },
  ];

  assert.equal(proposalsForMap(proposals, null), proposals);
  assert.deepEqual(proposalsForMap(proposals, 1), [proposals[1]]);
  assert.deepEqual(proposalsForMap(proposals, 99), []);
});

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
    [
      ['near-a', 'near-b'],
      ['far-culdesac', 'newer-neighbor'],
      ['orange-a', 'orange-b'],
    ],
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
  assert.ok(normal.estimatedHomes >= 21 && normal.estimatedHomes <= 39);

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
  assert.deepEqual(zero.proposals, []);
  assert.ok(zero.warnings.some((warning) => warning.includes('cleanup packet')));
});

test('large packet quantities retain mixed-size selection without materializing every slot', () => {
  const requests = [
    { quantity: Number.MAX_SAFE_INTEGER, targetHomes: 10 },
    { quantity: 1, targetHomes: 20 },
  ];
  const segments = [
    segment('small', [0, 0], [0.001, 0], 10, 'red'),
    segment('large', [0.01, 0], [0.011, 0], 20, 'red'),
  ];
  const input = { center: [0, 0] as Position, requests, segments };
  const result = generatePacketProposals(input);

  assert.deepEqual(
    result,
    generatePacketProposals({
      ...input,
      requests: [{ quantity: 3, targetHomes: 10 }, requests[1]],
    }),
  );
  assert.deepEqual(
    result.proposals.map(({ targetHomes }) => targetHomes),
    [10, 20],
  );
  assert.equal(requests[0].quantity, Number.MAX_SAFE_INTEGER);
  assert.ok(result.warnings.some((warning) => warning.includes('Generated fewer packets')));
});

test('exhausted request rows retain the precedence of later repeated packet sizes', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [
      { quantity: 2, targetHomes: 10 },
      { quantity: 1, targetHomes: 20 },
      { quantity: 2, targetHomes: 10 },
    ],
    segments: Array.from({ length: 5 }, (_, index) =>
      segment(`street-${index}`, [index * 0.01, 0], [index * 0.01 + 0.001, 0], 10, 'red'),
    ),
  });

  assert.deepEqual(
    result.proposals.map(({ targetHomes }) => targetHomes),
    [10, 10, 10, 10],
  );
  assert.ok(result.warnings.some((warning) => warning.includes('cleanup packet')));
});

test('a starting address beyond an oversized prefix does not cause a missing-address warning', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 10 }],
    segments: [
      segment('oversized-without-address', [0, 0], [0.001, 0], 60, 'red', { addresses: [] }),
      segment('address-too-far', [0.001, 0], [0.002, 0], 5, 'red'),
    ],
  });

  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.warnings, [
    'Some overdue streets need a smaller cleanup packet.',
    'Generated fewer packets because no more sensible eligible streets were available.',
  ]);
});

test('adjacency bounds preserve short named continuations at high latitudes', () => {
  const gap = 15 / (111_320 * Math.cos((80 * Math.PI) / 180));
  const result = generatePacketProposals({
    center: [0, 80],
    requests: [{ quantity: 1, targetHomes: 12 }],
    segments: [
      segment('west', [0, 80], [0.001, 80], 6, 'red', { streetName: 'Same Street' }),
      segment('east', [0.001 + gap, 80], [0.002 + gap, 80], 6, 'red', {
        streetName: 'Same Street',
      }),
    ],
  });

  assert.deepEqual(
    result.proposals[0]?.segments.map(({ id }) => id),
    ['west', 'east'],
  );
});

test('adjacency bounds include interior vertices of curved roads', () => {
  const curved = segment('curved', [0, 0], [0.002, 0], 6, 'red', {
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.001, 0.002],
        [0.002, 0],
      ],
    },
  });
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 10 }],
    segments: [curved, segment('branch', [0.001, 0.002], [0.002, 0.002], 4, 'red')],
  });

  assert.deepEqual(
    result.proposals[0]?.segments.map(({ id }) => id),
    ['curved', 'branch'],
  );
});

test('a tiny nearby component does not displace an available normal packet', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('tiny', [0, 0], [0.001, 0], 10, 'red'),
      segment('normal', [0.01, 0], [0.011, 0], 90, 'red'),
    ],
  });

  assert.deepEqual(
    result.proposals.map((proposal) => proposal.segments.map(({ id }) => id)),
    [['normal']],
  );
});

test('an overdue seed may use a connected newer range to reach the lower bound', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('old-seed', [0, 0], [0.001, 0], 10, 'red'),
      segment('newer-fill', [0.001, 0], [0.002, 0], 60, 'orange'),
    ],
  });

  assert.deepEqual(
    result.proposals.map((proposal) => proposal.segments.map(({ id }) => id)),
    [['old-seed', 'newer-fill']],
  );
  assert.equal(result.proposals[0].estimatedHomes, 70);
});

test('an attached small branch is absorbed instead of being stranded', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('first', [0, 0], [0.001, 0], 60, 'red'),
      segment('second', [0.001, 0], [0.002, 0], 40, 'red'),
      segment('culdesac', [0.001, 0], [0.001, 0.001], 10, 'red'),
    ],
  });

  assert.deepEqual(result.proposals[0].segments.map(({ id }) => id).sort(), [
    'culdesac',
    'first',
    'second',
  ]);
  assert.equal(result.proposals[0].estimatedHomes, 110);
});

test('orphan cleanup does not depend on the greedy street order', () => {
  const result = generatePacketProposals({
    center: [0.003, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('old-seed', [0, 0], [0.001, 0], 60, 'red', {
        lastCoveredOn: '2020-01-01',
      }),
      segment('second', [0.001, 0], [0.002, 0], 40, 'red', {
        lastCoveredOn: '2021-01-01',
      }),
      segment('large-remainder', [0.002, 0], [0.003, 0], 50, 'red', {
        lastCoveredOn: '2021-01-01',
      }),
      segment('culdesac', [0.001, 0], [0.001, 0.001], 10, 'red', {
        lastCoveredOn: '2021-01-01',
      }),
    ],
  });

  assert.deepEqual(
    result.proposals[0].segments.map(({ id }) => id),
    ['old-seed', 'second', 'culdesac'],
  );
});

test('batch cleanup fills a small gap bordered by generated packets', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 2, targetHomes: 100 }],
    segments: [
      segment('a-core', [0, 0], [0.001, 0], 100, 'red'),
      segment('b-core', [0.001, 0], [0.002, 0], 100, 'red'),
      segment('gap', [0.001, 0], [0.001, 0.001], 10, 'red'),
      segment('future-core', [0.001, 0.001], [0.001, 0.002], 100, 'red'),
    ],
  });

  assert.equal(result.proposals.length, 2);
  assert.ok(result.proposals.some((proposal) => proposal.segments.some(({ id }) => id === 'gap')));
});

test('a side-street endpoint meeting a road interior forms a packet junction', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('main-road', [0, 0], [0.002, 0], 60, 'red'),
      segment('side-street', [0.001, 0.00001], [0.001, 0.001], 40, 'red'),
    ],
  });

  assert.deepEqual(
    result.proposals[0].segments.map(({ id }) => id),
    ['main-road', 'side-street'],
  );
});

test('short aligned gaps in the same named road remain connected', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('enfield-a', [0, 0], [0.001, 0], 50, 'red', {
        streetName: 'Enfield Lane',
      }),
      segment('enfield-b', [0.00114, 0], [0.002, 0], 50, 'red', {
        streetName: 'Enfield Lane',
      }),
    ],
  });

  assert.deepEqual(
    result.proposals[0].segments.map(({ id }) => id),
    ['enfield-a', 'enfield-b'],
  );
});

test('nearby parallel roads are not treated as a junction', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [
      segment('lower-road', [0, 0], [0.002, 0], 50, 'red'),
      segment('upper-road', [0.001, 0.00002], [0.003, 0.00002], 50, 'red'),
    ],
  });

  assert.deepEqual(result.proposals, []);
});

test('exact coverage age outranks church distance within one heatmap range', () => {
  const newerNear = Object.assign(segment('newer-near', [0, 0], [0.001, 0], 100, 'red'), {
    lastCoveredOn: '2025-01-01',
  });
  const olderFar = Object.assign(segment('older-far', [0.01, 0], [0.011, 0], 100, 'red'), {
    lastCoveredOn: '2024-01-01',
  });
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 1, targetHomes: 100 }],
    segments: [newerNear, olderFar],
  });

  assert.deepEqual(
    result.proposals[0].segments.map(({ id }) => id),
    ['older-far'],
  );
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
    'Some overdue streets need a smaller cleanup packet.',
    'Generated fewer packets because no more sensible eligible streets were available.',
  ]);
});

test('configured apartments consume one requested slot and stay atomic outside the target range', () => {
  const result = generatePacketProposals({
    center: [0, 0],
    requests: [{ quantity: 2, targetHomes: 10 }],
    segments: [
      segment('older-street', [0, 0], [0.001, 0], 10, 'red', {
        lastCoveredOn: '2025-01-01',
      }),
    ],
    apartmentComplexes: [
      {
        id: 'old-apartment',
        address: '10 Apartment Way, Temecula CA 92591',
        position: [0.01, 0],
        tractCount: 24,
        accessStatus: 'restricted',
        eligible: true,
        reserved: false,
        coverageClass: 'red',
        lastCoveredOn: null,
      },
      {
        id: 'recent-apartment',
        address: '20 Apartment Way, Temecula CA 92591',
        position: [0.02, 0],
        tractCount: 12,
        accessStatus: 'open',
        eligible: true,
        reserved: false,
        coverageClass: 'green',
        lastCoveredOn: '2026-07-20',
      },
    ],
  });

  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0].apartmentId, 'old-apartment');
  assert.equal(result.proposals[0].targetHomes, 10);
  assert.equal(result.proposals[0].estimatedHomes, 24);
  assert.equal(result.proposals[0].accessStatus, 'restricted');
  assert.equal(result.proposals[1].segments[0].id, 'older-street');
  assert.equal(
    result.proposals.some(({ apartmentId }) => apartmentId === 'recent-apartment'),
    false,
  );
  assert.ok(result.warnings.some((warning) => warning.includes('24 confirmed tracts')));
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
        lastCoveredOn: null,
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
