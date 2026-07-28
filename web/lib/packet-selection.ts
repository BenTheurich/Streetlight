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
  addresses: PacketAddress[];
};

export type PacketSizeRequest = {
  quantity: number;
  targetHomes: number;
};

export type PacketProposal = {
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

type TargetSlot = { targetHomes: number; order: number };
type Prefix = {
  segments: PacketSelectionSegment[];
  estimatedHomes: number;
  area: number;
  start: PacketProposal['start'];
};

const coverageOrder: CoverageClass[] = ['red', 'orange', 'yellow', 'green'];

function endpointKey([longitude, latitude]: Position): string {
  return `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
}

function endpoints(segment: PacketSelectionSegment): [Position, Position] {
  return [segment.geometry.coordinates[0], segment.geometry.coordinates.at(-1) as Position];
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
): PacketSelectionSegment[] {
  const component: PacketSelectionSegment[] = [];
  const pending = [anchor];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const segment = pending.shift() as PacketSelectionSegment;
    if (visited.has(segment.id)) continue;
    visited.add(segment.id);
    component.push(segment);
    const keys = new Set(endpoints(segment).map(endpointKey));
    for (const candidate of available.values()) {
      if (
        !visited.has(candidate.id) &&
        endpoints(candidate).some((endpoint) => keys.has(endpointKey(endpoint)))
      ) {
        pending.push(candidate);
      }
    }
  }
  return component;
}

function connectedPrefixes(
  anchor: PacketSelectionSegment,
  component: PacketSelectionSegment[],
  center: Position,
): Prefix[] {
  const selected = [anchor];
  const remaining = new Map(
    component.filter((segment) => segment.id !== anchor.id).map((segment) => [segment.id, segment]),
  );
  const prefixes: Prefix[] = [];
  while (true) {
    const start = selectStart(selected, center);
    if (start) {
      prefixes.push({
        segments: [...selected],
        estimatedHomes: selected.reduce((sum, segment) => sum + segment.estimatedHomes, 0),
        area: boundingArea(selected, center),
        start,
      });
    }
    if (remaining.size === 0) break;
    const selectedEndpoints = new Set(
      selected.flatMap((segment) => endpoints(segment).map(endpointKey)),
    );
    const next = [...remaining.values()]
      .filter((segment) =>
        endpoints(segment).some((endpoint) => selectedEndpoints.has(endpointKey(endpoint))),
      )
      .sort(
        (a, b) =>
          compareNumbers(segmentDistance(a, center), segmentDistance(b, center)) ||
          compareNumbers(
            boundingArea([...selected, a], center),
            boundingArea([...selected, b], center),
          ) ||
          compareStrings(a.id, b.id),
      )[0];
    if (!next) break;
    selected.push(next);
    remaining.delete(next.id);
  }
  return prefixes;
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
}): PacketGenerationResult {
  const slots: TargetSlot[] = input.requests.flatMap((request) =>
    Array.from({ length: request.quantity }, () => ({
      targetHomes: request.targetHomes,
      order: 0,
    })),
  );
  slots.forEach((slot, index) => {
    slot.order = index;
  });
  const proposals: PacketProposal[] = [];
  const warnings: string[] = [];

  for (const coverageClass of coverageOrder) {
    const available = new Map(
      input.segments
        .filter(
          (segment) =>
            segment.eligible && !segment.reserved && segment.coverageClass === coverageClass,
        )
        .map((segment) => [segment.id, segment]),
    );
    while (slots.length > 0 && available.size > 0) {
      const anchor = [...available.values()].sort(
        (a, b) =>
          compareNumbers(segmentDistance(a, input.center), segmentDistance(b, input.center)) ||
          compareStrings(a.id, b.id),
      )[0];
      const component = componentFrom(anchor, available);
      const prefixes = connectedPrefixes(anchor, component, input.center);
      if (prefixes.length === 0) {
        for (const segment of component) available.delete(segment.id);
        const warning =
          'Skipped a connected area because no usable starting address was available.';
        if (!warnings.includes(warning)) warnings.push(warning);
        continue;
      }
      const choice = prefixes
        .flatMap((prefix) =>
          slots.map((slot) => ({
            prefix,
            slot,
            difference: Math.abs(prefix.estimatedHomes - slot.targetHomes) / slot.targetHomes,
          })),
        )
        .sort(
          (a, b) =>
            compareNumbers(a.difference <= 0.2 ? 0 : 1, b.difference <= 0.2 ? 0 : 1) ||
            compareNumbers(a.difference, b.difference) ||
            compareNumbers(a.prefix.area, b.prefix.area) ||
            compareNumbers(a.prefix.segments.length, b.prefix.segments.length) ||
            compareNumbers(a.slot.order, b.slot.order) ||
            compareStrings(
              a.prefix.segments.map(({ id }) => id).join('\0'),
              b.prefix.segments.map(({ id }) => id).join('\0'),
            ),
        )[0];
      proposals.push({
        targetHomes: choice.slot.targetHomes,
        estimatedHomes: choice.prefix.estimatedHomes,
        coverageClass,
        segments: choice.prefix.segments.map(({ id, geometry, estimatedHomes }) => ({
          id,
          geometry,
          estimatedHomes,
        })),
        start: choice.prefix.start,
        streetNames: [
          ...new Set(choice.prefix.segments.map(({ streetName }) => streetName)),
        ].sort(),
      });
      for (const segment of choice.prefix.segments) available.delete(segment.id);
      slots.splice(slots.indexOf(choice.slot), 1);
    }
    if (slots.length === 0) break;
  }
  if (slots.length > 0) {
    warnings.push('Generated fewer packets because no more eligible streets were available.');
  }
  return { proposals, warnings };
}
