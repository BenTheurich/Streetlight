import type { CoverageClass } from './coverage.ts';
import type { LineString, Position } from './territory-geometry.ts';

export type PacketAddress = {
  number: string | null;
  street: string;
  locality: string | null;
  postcode: string | null;
  position: Position;
};

export type PacketSelectionSegment = {
  id: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  eligible: boolean;
  reserved: boolean;
  coverageClass: CoverageClass;
  lastCoveredOn: string | null;
  addresses: PacketAddress[];
};

export type ApartmentPacketCandidate = {
  id: string;
  address: string;
  position: Position;
  tractCount: number;
  accessStatus: 'open' | 'restricted';
  eligible: boolean;
  reserved: boolean;
  coverageClass: CoverageClass;
  lastCoveredOn: string | null;
};

export type PacketGenerationWorkspace = {
  center: Position;
  segments: PacketSelectionSegment[];
  apartmentComplexes: ApartmentPacketCandidate[];
};

export type PacketSizeRequest = {
  quantity: number;
  targetHomes: number;
};

export type PacketProposal = {
  kind?: 'apartment';
  apartmentId?: string;
  accessStatus?: 'open' | 'restricted';
  targetHomes: number;
  estimatedHomes: number;
  coverageClass: CoverageClass;
  segments: Array<{
    id: string;
    geometry: LineString;
    estimatedHomes: number;
  }>;
  start: { address: string; position: Position };
  streetNames: string[];
};

export type PacketGenerationResult = {
  proposals: PacketProposal[];
  warnings: string[];
};

export function proposalsForMap(
  proposals: PacketProposal[],
  selectedIndex: number | null,
): PacketProposal[] {
  if (selectedIndex === null) return proposals;
  return proposals[selectedIndex] ? [proposals[selectedIndex]] : [];
}

type TargetSlot = PacketSizeRequest & { order: number };
type Prefix = {
  segments: PacketSelectionSegment[];
  estimatedHomes: number;
  area: number;
  start: PacketProposal['start'];
};
type Adjacency = Map<string, Set<string>>;

const coverageOrder: CoverageClass[] = ['red', 'orange', 'yellow', 'green'];
const metersPerDegree = 111_320;
const junctionToleranceMeters = 3;
const continuationGapMeters = 20;

function endpointKey([longitude, latitude]: Position): string {
  return `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
}

function endpoints(segment: PacketSelectionSegment): [Position, Position] {
  return [segment.geometry.coordinates[0], segment.geometry.coordinates.at(-1) as Position];
}

function connect(adjacency: Adjacency, first: string, second: string): void {
  adjacency.get(first)?.add(second);
  adjacency.get(second)?.add(first);
}

function vector(start: Position, end: Position): Position {
  return [(end[0] - start[0]) * Math.cos(((start[1] + end[1]) * Math.PI) / 360), end[1] - start[1]];
}

function absoluteCosine(first: Position, second: Position): number {
  const firstLength = Math.hypot(...first);
  const secondLength = Math.hypot(...second);
  if (firstLength === 0 || secondLength === 0) return 1;
  return Math.abs((first[0] * second[0] + first[1] * second[1]) / firstLength / secondLength);
}

function terminalDirections(segment: PacketSelectionSegment): Array<{
  point: Position;
  direction: Position;
}> {
  const coordinates = segment.geometry.coordinates;
  return [
    { point: coordinates[0], direction: vector(coordinates[0], coordinates[1]) },
    {
      point: coordinates.at(-1) as Position,
      direction: vector(coordinates.at(-2) as Position, coordinates.at(-1) as Position),
    },
  ];
}

export function endpointMeetsInterior(
  endpoint: { point: Position; direction: Position },
  geometry: LineString,
): boolean {
  let best: { distanceMeters: number; direction: Position; projected: Position } | undefined;
  for (let index = 1; index < geometry.coordinates.length; index += 1) {
    const start = geometry.coordinates[index - 1];
    const end = geometry.coordinates[index];
    const scale = Math.cos(((endpoint.point[1] + start[1] + end[1]) * Math.PI) / 540);
    const x = (endpoint.point[0] - start[0]) * scale;
    const y = endpoint.point[1] - start[1];
    const dx = (end[0] - start[0]) * scale;
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const amount =
      lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));
    const projected: Position = [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
    ];
    const distanceMeters =
      Math.sqrt(scaledDistanceSquared(endpoint.point, projected)) * metersPerDegree;
    if (!best || distanceMeters < best.distanceMeters) {
      best = { distanceMeters, direction: vector(start, end), projected };
    }
  }
  if (!best || best.distanceMeters > junctionToleranceMeters) return false;
  const [lineStart, lineEnd] = [geometry.coordinates[0], geometry.coordinates.at(-1) as Position];
  const projectionIsInterior =
    Math.sqrt(scaledDistanceSquared(best.projected, lineStart)) * metersPerDegree >
      junctionToleranceMeters &&
    Math.sqrt(scaledDistanceSquared(best.projected, lineEnd)) * metersPerDegree >
      junctionToleranceMeters;
  return projectionIsInterior && absoluteCosine(endpoint.direction, best.direction) < 0.9;
}

function sameNamedContinuation(
  first: PacketSelectionSegment,
  second: PacketSelectionSegment,
): boolean {
  const firstName = first.streetName.trim().toLocaleLowerCase();
  if (!firstName || firstName !== second.streetName.trim().toLocaleLowerCase()) return false;
  return terminalDirections(first).some((firstEndpoint) =>
    terminalDirections(second).some((secondEndpoint) => {
      const gap = vector(firstEndpoint.point, secondEndpoint.point);
      return (
        Math.hypot(...gap) * metersPerDegree <= continuationGapMeters &&
        absoluteCosine(firstEndpoint.direction, gap) > 0.85 &&
        absoluteCosine(secondEndpoint.direction, gap) > 0.85
      );
    }),
  );
}

function buildAdjacency(segments: PacketSelectionSegment[]): Adjacency {
  const adjacency = new Map(segments.map((segment) => [segment.id, new Set<string>()]));
  const bounds = segments.map(({ geometry }) =>
    geometry.coordinates.reduce(
      (box, [longitude, latitude]) => ({
        west: Math.min(box.west, longitude),
        east: Math.max(box.east, longitude),
        south: Math.min(box.south, latitude),
        north: Math.max(box.north, latitude),
      }),
      { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
    ),
  );
  const byEndpoint = new Map<string, string[]>();
  for (const segment of segments) {
    for (const endpoint of endpoints(segment)) {
      const key = endpointKey(endpoint);
      const ids = byEndpoint.get(key) ?? [];
      ids.push(segment.id);
      byEndpoint.set(key, ids);
    }
  }
  for (const ids of byEndpoint.values()) {
    for (const id of ids) {
      for (const other of ids) {
        if (other !== id) connect(adjacency, id, other);
      }
    }
  }
  // Reject distant bounds before exact junction tests; preserve the original pair order.
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      const a = bounds[firstIndex];
      const b = bounds[secondIndex];
      const latitudeGap = Math.max(a.south - b.north, b.south - a.north, 0);
      if (latitudeGap * metersPerDegree > continuationGapMeters) continue;
      const longitudeGap = Math.max(a.west - b.east, b.west - a.east, 0);
      // Every point and projected point lies within these latitudes. The smallest
      // longitude scale therefore gives a conservative lower bound on separation.
      const longitudeScale = Math.cos(
        (Math.max(Math.abs(a.south), Math.abs(a.north), Math.abs(b.south), Math.abs(b.north)) *
          Math.PI) /
          180,
      );
      if (longitudeGap * longitudeScale * metersPerDegree > continuationGapMeters) continue;
      if (adjacency.get(first.id)?.has(second.id)) continue;
      if (
        terminalDirections(first).some((endpoint) =>
          endpointMeetsInterior(endpoint, second.geometry),
        ) ||
        terminalDirections(second).some((endpoint) =>
          endpointMeetsInterior(endpoint, first.geometry),
        ) ||
        sameNamedContinuation(first, second)
      ) {
        connect(adjacency, first.id, second.id);
      }
    }
  }
  return adjacency;
}

function usableAddress(address: PacketAddress): boolean {
  return address.number !== null && address.number.trim() !== '' && address.street.trim() !== '';
}

function formatAddress(address: PacketAddress): string {
  const locality = [address.locality, address.postcode].filter(Boolean).join(' ');
  return `${address.number} ${address.street}${locality ? `, ${locality}` : ''}`;
}

function scaledDistanceSquared(a: Position, b: Position): number {
  const longitude = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const latitude = a[1] - b[1];
  return longitude * longitude + latitude * latitude;
}

function nearestPoint(point: Position, geometry: LineString): Position {
  let nearest = geometry.coordinates[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < geometry.coordinates.length; index += 1) {
    const start = geometry.coordinates[index - 1];
    const end = geometry.coordinates[index];
    const scale = Math.cos(((point[1] + start[1] + end[1]) * Math.PI) / 540);
    const x = (point[0] - start[0]) * scale;
    const y = point[1] - start[1];
    const dx = (end[0] - start[0]) * scale;
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const amount =
      lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));
    const candidate: Position = [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
    ];
    const distance = scaledDistanceSquared(point, candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function segmentDistance(segment: PacketSelectionSegment, point: Position): number {
  return scaledDistanceSquared(point, nearestPoint(point, segment.geometry));
}

function boundingArea(segments: PacketSelectionSegment[], center: Position): number {
  const points = segments.flatMap((segment) => segment.geometry.coordinates);
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return (
    (Math.max(...longitudes) - Math.min(...longitudes)) *
    Math.cos((center[1] * Math.PI) / 180) *
    (Math.max(...latitudes) - Math.min(...latitudes))
  );
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareKeys(a: Array<number | string>, b: Array<number | string>): number {
  for (let index = 0; index < a.length; index += 1) {
    const difference =
      typeof a[index] === 'number'
        ? compareNumbers(a[index] as number, b[index] as number)
        : compareStrings(a[index] as string, b[index] as string);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareCoverageAge(
  first: Pick<PacketSelectionSegment, 'coverageClass' | 'lastCoveredOn'>,
  second: Pick<PacketSelectionSegment, 'coverageClass' | 'lastCoveredOn'>,
): number {
  const classDifference = compareNumbers(
    coverageOrder.indexOf(first.coverageClass),
    coverageOrder.indexOf(second.coverageClass),
  );
  if (classDifference !== 0) return classDifference;
  if (first.lastCoveredOn === null) return second.lastCoveredOn === null ? 0 : -1;
  if (second.lastCoveredOn === null) return 1;
  return compareStrings(first.lastCoveredOn, second.lastCoveredOn);
}

function selectStart(
  segments: PacketSelectionSegment[],
  center: Position,
): PacketProposal['start'] | null {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const endpoint of endpoints(segment)) {
      const key = endpointKey(endpoint);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const terminals = segments
    .flatMap((segment) =>
      endpoints(segment)
        .filter((endpoint) => counts.get(endpointKey(endpoint)) === 1)
        .map((endpoint) => ({ segment, endpoint })),
    )
    .sort((a, b) => compareStrings(endpointKey(a.endpoint), endpointKey(b.endpoint)));
  const terminalKeys = new Set(terminals.map(({ segment }) => segment.id));
  const terminalCandidates = segments
    .filter((segment) => terminalKeys.has(segment.id))
    .flatMap((segment) => {
      const outerEndpoints = terminals
        .filter((terminal) => terminal.segment.id === segment.id)
        .map(({ endpoint }) => endpoint)
        .sort(
          (a, b) =>
            compareNumbers(scaledDistanceSquared(b, center), scaledDistanceSquared(a, center)) ||
            compareStrings(endpointKey(a), endpointKey(b)),
        );
      const outer = outerEndpoints[0];
      return segment.addresses.filter(usableAddress).map((address) => {
        const roadPoint = nearestPoint(address.position, segment.geometry);
        return {
          address,
          key: [
            address.position[1] >= roadPoint[1] ? 0 : 1,
            scaledDistanceSquared(address.position, outer),
            formatAddress(address),
            endpointKey(address.position),
          ] as Array<number | string>,
        };
      });
    })
    .sort((a, b) => compareKeys(a.key, b.key));
  const terminal = terminalCandidates[0]?.address;
  if (terminal) return { address: formatAddress(terminal), position: terminal.position };

  const allCandidates = segments
    .flatMap((segment) => segment.addresses)
    .filter(usableAddress)
    .map((address) => ({
      address,
      key: [
        terminals.length === 0
          ? scaledDistanceSquared(address.position, center)
          : Math.min(
              ...terminals.map(({ endpoint }) => scaledDistanceSquared(address.position, endpoint)),
            ),
        formatAddress(address),
        endpointKey(address.position),
      ] as Array<number | string>,
    }))
    .sort((a, b) => compareKeys(a.key, b.key));
  const fallback = allCandidates[0]?.address;
  return fallback ? { address: formatAddress(fallback), position: fallback.position } : null;
}

function componentFrom(
  anchor: PacketSelectionSegment,
  available: Map<string, PacketSelectionSegment>,
  adjacency: Adjacency,
): PacketSelectionSegment[] {
  const component: PacketSelectionSegment[] = [];
  const pending = [anchor];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const segment = pending.shift() as PacketSelectionSegment;
    if (visited.has(segment.id)) continue;
    visited.add(segment.id);
    component.push(segment);
    for (const id of adjacency.get(segment.id) ?? []) {
      const candidate = available.get(id);
      if (candidate && !visited.has(candidate.id)) pending.push(candidate);
    }
  }
  return component;
}

function connectedPrefixes(
  anchor: PacketSelectionSegment,
  component: PacketSelectionSegment[],
  center: Position,
  adjacency: Adjacency,
  upperBound: number,
): Prefix[] {
  const selected = [anchor];
  let estimatedHomes = anchor.estimatedHomes;
  const remaining = new Map(
    component.filter((segment) => segment.id !== anchor.id).map((segment) => [segment.id, segment]),
  );
  const prefixes: Prefix[] = [];
  while (true) {
    const start = selectStart(selected, center);
    if (start) {
      prefixes.push({
        segments: [...selected],
        estimatedHomes,
        area: boundingArea(selected, center),
        start,
      });
    }
    // Home counts cannot decrease; later prefixes cannot fit any requested size.
    // Keep the first prefix so an indivisible oversized segment remains eligible.
    if (remaining.size === 0 || estimatedHomes > upperBound) break;
    const selectedIds = new Set(selected.map((segment) => segment.id));
    const next = [...remaining.values()]
      .filter((segment) => [...(adjacency.get(segment.id) ?? [])].some((id) => selectedIds.has(id)))
      .sort(
        (a, b) =>
          compareNumbers(
            coverageOrder.indexOf(a.coverageClass),
            coverageOrder.indexOf(b.coverageClass),
          ) ||
          compareNumbers(segmentDistance(a, center), segmentDistance(b, center)) ||
          compareNumbers(
            boundingArea([...selected, a], center),
            boundingArea([...selected, b], center),
          ) ||
          compareStrings(a.id, b.id),
      )[0];
    if (!next) break;
    selected.push(next);
    estimatedHomes += next.estimatedHomes;
    remaining.delete(next.id);
  }
  return prefixes;
}

function remainderComponents(
  selected: PacketSelectionSegment[],
  component: PacketSelectionSegment[],
  adjacency: Adjacency,
): PacketSelectionSegment[][] {
  const selectedIds = new Set(selected.map(({ id }) => id));
  const remaining = new Map(
    component
      .filter((segment) => !selectedIds.has(segment.id))
      .map((segment) => [segment.id, segment]),
  );
  const remainders: PacketSelectionSegment[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as PacketSelectionSegment;
    const remainder = componentFrom(seed, remaining, adjacency);
    remainders.push(remainder);
    for (const segment of remainder) remaining.delete(segment.id);
  }
  return remainders;
}

function orphanedHomes(
  selected: PacketSelectionSegment[],
  component: PacketSelectionSegment[],
  adjacency: Adjacency,
  minimumViableHomes: number,
): number {
  return remainderComponents(selected, component, adjacency).reduce((total, remainder) => {
    const homes = remainder.reduce((sum, segment) => sum + segment.estimatedHomes, 0);
    return homes < minimumViableHomes ? total + homes : total;
  }, 0);
}

function absorbOrphans(
  prefix: Prefix,
  component: PacketSelectionSegment[],
  adjacency: Adjacency,
  minimumViableHomes: number,
  upperBound: number,
  center: Position,
): Prefix {
  const selected = [...prefix.segments];
  let estimatedHomes = prefix.estimatedHomes;
  const orphans = remainderComponents(selected, component, adjacency)
    .map((segments) => ({
      segments: [...segments].sort((a, b) => compareStrings(a.id, b.id)),
      estimatedHomes: segments.reduce((sum, segment) => sum + segment.estimatedHomes, 0),
    }))
    .filter(({ estimatedHomes: homes }) => homes < minimumViableHomes)
    .sort(
      (a, b) =>
        compareNumbers(a.estimatedHomes, b.estimatedHomes) ||
        compareStrings(
          a.segments.map(({ id }) => id).join('\0'),
          b.segments.map(({ id }) => id).join('\0'),
        ),
    );
  for (const orphan of orphans) {
    if (estimatedHomes + orphan.estimatedHomes > upperBound) continue;
    selected.push(...orphan.segments);
    estimatedHomes += orphan.estimatedHomes;
  }
  if (selected.length === prefix.segments.length) return prefix;
  const start = selectStart(selected, center);
  return start
    ? {
        segments: selected,
        estimatedHomes,
        area: boundingArea(selected, center),
        start,
      }
    : prefix;
}

function fillBorderedGaps(
  proposals: PacketProposal[],
  available: Map<string, PacketSelectionSegment>,
  allSegments: Map<string, PacketSelectionSegment>,
  adjacency: Adjacency,
  center: Position,
): void {
  while (true) {
    const owners = new Map<string, number>();
    for (const [proposalIndex, proposal] of proposals.entries()) {
      for (const segment of proposal.segments) owners.set(segment.id, proposalIndex);
    }
    const candidate = [...available.values()]
      .map((segment) => {
        const neighboringOwners = [...(adjacency.get(segment.id) ?? [])]
          .map((id) => owners.get(id))
          .filter((owner): owner is number => owner !== undefined);
        return { segment, neighboringOwners };
      })
      .filter(({ neighboringOwners }) => neighboringOwners.length >= 2)
      .sort(
        (a, b) =>
          compareNumbers(a.segment.estimatedHomes, b.segment.estimatedHomes) ||
          compareCoverageAge(a.segment, b.segment) ||
          compareStrings(a.segment.id, b.segment.id),
      )[0];
    if (!candidate) return;

    const ownerCounts = new Map<number, number>();
    for (const owner of candidate.neighboringOwners) {
      ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
    }
    const owner = [...ownerCounts]
      .filter(
        ([proposalIndex]) =>
          proposals[proposalIndex].estimatedHomes + candidate.segment.estimatedHomes <=
          proposals[proposalIndex].targetHomes * 1.3,
      )
      .sort(
        (a, b) =>
          compareNumbers(b[1], a[1]) ||
          compareNumbers(proposals[a[0]].estimatedHomes, proposals[b[0]].estimatedHomes) ||
          compareNumbers(a[0], b[0]),
      )[0]?.[0];
    if (owner === undefined) {
      available.delete(candidate.segment.id);
      continue;
    }

    const proposal = proposals[owner];
    proposal.segments.push({
      id: candidate.segment.id,
      geometry: candidate.segment.geometry,
      estimatedHomes: candidate.segment.estimatedHomes,
    });
    proposal.estimatedHomes += candidate.segment.estimatedHomes;
    proposal.streetNames = [
      ...new Set([...proposal.streetNames, candidate.segment.streetName]),
    ].sort();
    const selected = proposal.segments.map(
      ({ id }) => allSegments.get(id) as PacketSelectionSegment,
    );
    proposal.start = selectStart(selected, center) ?? proposal.start;
    available.delete(candidate.segment.id);
  }
}

export function parsePacketSizeRequests(value: unknown): PacketSizeRequest[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid packet request');
  return value.map((row) => {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, 'quantity') ||
      !Object.hasOwn(row, 'targetHomes')
    ) {
      throw new Error('Invalid packet request');
    }
    const { quantity, targetHomes } = row as Record<string, unknown>;
    if (
      !Number.isSafeInteger(quantity) ||
      !Number.isSafeInteger(targetHomes) ||
      (quantity as number) <= 0 ||
      (targetHomes as number) <= 0
    ) {
      throw new Error('Invalid packet request');
    }
    return { quantity: quantity as number, targetHomes: targetHomes as number };
  });
}

export function generatePacketProposals(input: {
  center: Position;
  requests: PacketSizeRequest[];
  segments: PacketSelectionSegment[];
  apartmentComplexes?: ApartmentPacketCandidate[];
}): PacketGenerationResult {
  // Equal-size slots within a request are interchangeable; retain their count
  // and the request's precedence without allocating one object per packet.
  const slots: TargetSlot[] = input.requests.map((request, order) => ({ ...request, order }));
  const proposals: PacketProposal[] = [];
  const warnings: string[] = [];
  const available = new Map(
    input.segments
      .filter((segment) => segment.eligible && !segment.reserved)
      .map((segment) => [segment.id, segment]),
  );
  const allSegments = new Map(available);
  const availableApartments = new Map(
    (input.apartmentComplexes ?? [])
      .filter((apartment) => apartment.eligible && !apartment.reserved)
      .map((apartment) => [apartment.id, apartment]),
  );
  const adjacency = buildAdjacency([...available.values()]);

  while (slots.length > 0 && (available.size > 0 || availableApartments.size > 0)) {
    const anchors = [...available.values()].sort(
      (a, b) =>
        compareCoverageAge(a, b) ||
        compareNumbers(segmentDistance(a, input.center), segmentDistance(b, input.center)) ||
        compareStrings(a.id, b.id),
    );
    let choice:
      | {
          prefix: Prefix;
          slot: TargetSlot;
          difference: number;
          orphanedHomes: number;
          coverageClass: CoverageClass;
          anchor: PacketSelectionSegment;
        }
      | undefined;
    let missingAddress = false;
    const minimumViableHomes = slots.reduce(
      (minimum, { targetHomes }) => Math.min(minimum, targetHomes * 0.7),
      Infinity,
    );
    const upperBound = slots.reduce(
      (maximum, { targetHomes }) => Math.max(maximum, targetHomes * 1.3),
      0,
    );

    for (const anchor of anchors) {
      const component = componentFrom(anchor, available, adjacency);
      const prefixes = connectedPrefixes(anchor, component, input.center, adjacency, upperBound);
      if (prefixes.length === 0) {
        missingAddress ||= !component.some(({ addresses }) => addresses.some(usableAddress));
        continue;
      }
      choice = prefixes
        .flatMap((prefix) =>
          slots.flatMap((slot) => {
            const expanded = absorbOrphans(
              prefix,
              component,
              adjacency,
              minimumViableHomes,
              slot.targetHomes * 1.3,
              input.center,
            );
            if (
              !(
                (expanded.estimatedHomes >= slot.targetHomes * 0.7 &&
                  expanded.estimatedHomes <= slot.targetHomes * 1.3) ||
                (expanded.segments.length === 1 && expanded.estimatedHomes > slot.targetHomes * 1.3)
              )
            ) {
              return [];
            }
            return [
              {
                prefix: expanded,
                slot,
                difference: Math.abs(expanded.estimatedHomes - slot.targetHomes) / slot.targetHomes,
                orphanedHomes: orphanedHomes(
                  expanded.segments,
                  component,
                  adjacency,
                  minimumViableHomes,
                ),
                coverageClass: anchor.coverageClass,
                anchor,
              },
            ];
          }),
        )
        .sort(
          (a, b) =>
            compareNumbers(a.orphanedHomes, b.orphanedHomes) ||
            compareNumbers(a.difference, b.difference) ||
            compareNumbers(a.prefix.area, b.prefix.area) ||
            compareNumbers(a.prefix.segments.length, b.prefix.segments.length) ||
            compareNumbers(a.slot.order, b.slot.order) ||
            compareStrings(
              a.prefix.segments.map(({ id }) => id).join('\0'),
              b.prefix.segments.map(({ id }) => id).join('\0'),
            ),
        )[0];
      if (choice) break;
    }

    const apartment = [...availableApartments.values()].sort(
      (a, b) =>
        compareCoverageAge(a, b) ||
        compareNumbers(
          scaledDistanceSquared(a.position, input.center),
          scaledDistanceSquared(b.position, input.center),
        ) ||
        compareStrings(a.id, b.id),
    )[0];
    const apartmentSlot = apartment
      ? [...slots].sort(
          (a, b) =>
            compareNumbers(
              Math.abs(apartment.tractCount - a.targetHomes) / a.targetHomes,
              Math.abs(apartment.tractCount - b.targetHomes) / b.targetHomes,
            ) || compareNumbers(a.order, b.order),
        )[0]
      : undefined;
    const apartmentDifference =
      apartment && apartmentSlot
        ? Math.abs(apartment.tractCount - apartmentSlot.targetHomes) / apartmentSlot.targetHomes
        : Number.POSITIVE_INFINITY;
    const apartmentAge = apartment && choice ? compareCoverageAge(apartment, choice.anchor) : -1;
    const chooseApartment =
      apartment &&
      apartmentSlot &&
      (!choice ||
        apartmentAge < 0 ||
        (apartmentAge === 0 &&
          (apartmentDifference < choice.difference ||
            (apartmentDifference === choice.difference &&
              compareStrings(apartment.id, choice.anchor.id) < 0))));
    if (chooseApartment) {
      proposals.push({
        kind: 'apartment',
        apartmentId: apartment.id,
        accessStatus: apartment.accessStatus,
        targetHomes: apartmentSlot.targetHomes,
        estimatedHomes: apartment.tractCount,
        coverageClass: apartment.coverageClass,
        segments: [],
        start: { address: apartment.address, position: apartment.position },
        streetNames: [],
      });
      if (
        apartment.tractCount < apartmentSlot.targetHomes * 0.7 ||
        apartment.tractCount > apartmentSlot.targetHomes * 1.3
      ) {
        warnings.push(
          `${apartment.address} has ${apartment.tractCount} confirmed tract${apartment.tractCount === 1 ? '' : 's'}, outside the requested packet range.`,
        );
      }
      availableApartments.delete(apartment.id);
      apartmentSlot.quantity -= 1;
      if (apartmentSlot.quantity === 0) slots.splice(slots.indexOf(apartmentSlot), 1);
      continue;
    }

    if (!choice) {
      if (missingAddress) {
        warnings.push('Skipped a connected area because no usable starting address was available.');
      }
      warnings.push('Some overdue streets need a smaller cleanup packet.');
      break;
    }

    proposals.push({
      targetHomes: choice.slot.targetHomes,
      estimatedHomes: choice.prefix.estimatedHomes,
      coverageClass: choice.coverageClass,
      segments: choice.prefix.segments.map(({ id, geometry, estimatedHomes }) => ({
        id,
        geometry,
        estimatedHomes,
      })),
      start: choice.prefix.start,
      streetNames: [...new Set(choice.prefix.segments.map(({ streetName }) => streetName))].sort(),
    });
    for (const segment of choice.prefix.segments) available.delete(segment.id);
    choice.slot.quantity -= 1;
    if (choice.slot.quantity === 0) slots.splice(slots.indexOf(choice.slot), 1);
  }
  fillBorderedGaps(proposals, available, allSegments, adjacency, input.center);
  if (slots.length > 0) {
    warnings.push(
      'Generated fewer packets because no more sensible eligible streets were available.',
    );
  }
  return { proposals, warnings };
}
