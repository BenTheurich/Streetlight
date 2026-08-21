import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import type { LineString, Polygon, Position } from './territory-geometry.ts';
import { type ImportBounds, OVERTURE_RELEASE } from './territory-import.ts';

const IMPORT_REQUEST_TOLERANCE = 1e-9;
const IMPORT_TIMEOUT_MS = 15 * 60_000;

export type ImportedSegmentAddress = {
  number: string | null;
  street: string;
  locality: string | null;
  postcode: string | null;
  position: Position;
};

export type ImportedTerritorySegment = {
  id: string;
  sourceSegmentId: string;
  roadGroupId: string;
  roadClass: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  activationKind: 'automatic' | 'hidden';
  addresses: ImportedSegmentAddress[];
};

export type ImportedApartmentComplex = {
  id: string;
  sourceId: string;
  address: string | null;
  position: Position;
  estimatedTracts: number;
  evidence: {
    apartmentBuilding: boolean;
    distinctUnits: number;
  };
};

export type ImportQuality = {
  totalAddresses: number;
  assignedAddresses: number;
  spatiallyAssignedAddresses: number;
  inferredRoads: number;
  unmatchedAddresses: number;
  unresolvedClusters: number;
  totalResidentialBuildings: number;
  fallbackBuildings: number;
  unmatchedResidentialBuildings: number;
  populatedUnnamedRoads: number;
  buildingAddressDisagreements: number;
  warnings: string[];
};

export type ImportedMapBuilding = {
  source: 'overture' | 'fema';
  sourceId: string;
  geometry:
    | Polygon
    | {
        type: 'MultiPolygon';
        coordinates: Position[][][];
      };
  fema: null | {
    addressSourceId: string;
    distanceMeters: number;
    occupancy: 'Single Family Dwelling';
    outbuilding: false;
    source: string | null;
    productDate: string | null;
    imageDate: string | null;
  };
};

export type ImportedTerritoryInput = {
  release: typeof OVERTURE_RELEASE;
  center: Position;
  radiusMiles: number;
  completedAt: string;
  normalizerVersion: 10;
  buildingMode: 'overture_fema' | 'overture_only';
  mapBuildings: ImportedMapBuilding[];
  quality: ImportQuality;
  apartmentComplexes: ImportedApartmentComplex[];
  segments: ImportedTerritorySegment[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function isGeographicPosition(value: unknown): value is Position {
  return (
    isPosition(value) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isImportedAddress(value: unknown): value is ImportedSegmentAddress {
  return (
    isRecord(value) &&
    hasKeys(value, ['locality', 'number', 'position', 'postcode', 'street']) &&
    isNullableString(value.number) &&
    typeof value.street === 'string' &&
    value.street.trim() !== '' &&
    isNullableString(value.locality) &&
    isNullableString(value.postcode) &&
    isGeographicPosition(value.position)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isPolygonCoordinates(value: unknown): value is Position[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(isGeographicPosition) &&
        ring[0][0] === ring.at(-1)?.[0] &&
        ring[0][1] === ring.at(-1)?.[1],
    )
  );
}

function parseMapBuildings(value: unknown, mode: unknown): ImportedMapBuilding[] {
  if ((mode !== 'overture_fema' && mode !== 'overture_only') || !Array.isArray(value)) {
    failImportOutput();
  }
  const ids = new Set<string>();
  return value.map((building): ImportedMapBuilding => {
    if (
      !isRecord(building) ||
      !hasKeys(building, ['fema', 'geometry', 'source', 'sourceId']) ||
      (building.source !== 'overture' && building.source !== 'fema') ||
      typeof building.sourceId !== 'string' ||
      building.sourceId.trim() === '' ||
      ids.has(`${building.source}:${building.sourceId}`) ||
      !isRecord(building.geometry) ||
      !hasKeys(building.geometry, ['coordinates', 'type']) ||
      !(
        (building.geometry.type === 'Polygon' &&
          isPolygonCoordinates(building.geometry.coordinates)) ||
        (building.geometry.type === 'MultiPolygon' &&
          Array.isArray(building.geometry.coordinates) &&
          building.geometry.coordinates.length > 0 &&
          building.geometry.coordinates.every(isPolygonCoordinates))
      )
    ) {
      failImportOutput();
    }
    const geometry = building.geometry as ImportedMapBuilding['geometry'];
    if (building.source === 'overture') {
      if (building.fema !== null) failImportOutput();
      ids.add(`overture:${building.sourceId}`);
      return { source: 'overture', sourceId: building.sourceId, geometry, fema: null };
    }
    if (
      mode !== 'overture_fema' ||
      !isRecord(building.fema) ||
      !hasKeys(building.fema, [
        'addressSourceId',
        'distanceMeters',
        'imageDate',
        'occupancy',
        'outbuilding',
        'productDate',
        'source',
      ]) ||
      typeof building.fema.addressSourceId !== 'string' ||
      building.fema.addressSourceId.trim() === '' ||
      typeof building.fema.distanceMeters !== 'number' ||
      !Number.isFinite(building.fema.distanceMeters) ||
      building.fema.distanceMeters < 0 ||
      building.fema.distanceMeters > 10 ||
      building.fema.occupancy !== 'Single Family Dwelling' ||
      building.fema.outbuilding !== false ||
      !isNullableString(building.fema.source) ||
      !isNullableString(building.fema.productDate) ||
      !isNullableString(building.fema.imageDate) ||
      (building.fema.productDate !== null && !isIsoTimestamp(building.fema.productDate)) ||
      (building.fema.imageDate !== null && !isIsoTimestamp(building.fema.imageDate))
    ) {
      failImportOutput();
    }
    ids.add(`fema:${building.sourceId}`);
    return {
      source: 'fema',
      sourceId: building.sourceId,
      geometry,
      fema: {
        addressSourceId: building.fema.addressSourceId,
        distanceMeters: building.fema.distanceMeters,
        occupancy: 'Single Family Dwelling',
        outbuilding: false,
        source: building.fema.source,
        productDate: building.fema.productDate,
        imageDate: building.fema.imageDate,
      },
    };
  });
}

function isSuccessfulImportQuality(value: unknown): value is ImportQuality {
  const countKeys = [
    'assignedAddresses',
    'buildingAddressDisagreements',
    'fallbackBuildings',
    'inferredRoads',
    'populatedUnnamedRoads',
    'spatiallyAssignedAddresses',
    'totalAddresses',
    'totalResidentialBuildings',
    'unmatchedAddresses',
    'unmatchedResidentialBuildings',
    'unresolvedClusters',
  ];
  return (
    isRecord(value) &&
    hasKeys(value, [
      'assignedAddresses',
      'buildingAddressDisagreements',
      'fallbackBuildings',
      'inferredRoads',
      'populatedUnnamedRoads',
      'spatiallyAssignedAddresses',
      'totalAddresses',
      'totalResidentialBuildings',
      'unmatchedAddresses',
      'unmatchedResidentialBuildings',
      'unresolvedClusters',
      'warnings',
    ]) &&
    countKeys.every((key) => Number.isInteger(value[key]) && (value[key] as number) >= 0) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string' && warning.trim() !== '') &&
    (value.assignedAddresses as number) + (value.unmatchedAddresses as number) ===
      value.totalAddresses &&
    (value.spatiallyAssignedAddresses as number) <= (value.assignedAddresses as number) &&
    (value.fallbackBuildings as number) + (value.unmatchedResidentialBuildings as number) <=
      (value.totalResidentialBuildings as number)
  );
}

function failImportOutput(): never {
  throw new Error('Invalid Overture import output');
}

export function buildImporterArguments(
  center: Position,
  radiusMiles: number,
  bounds?: ImportBounds,
): string[] {
  if (!isGeographicPosition(center)) {
    throw new Error('Invalid import center');
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    throw new Error('Invalid import radius');
  }
  const result = [
    '--longitude',
    String(center[0]),
    '--latitude',
    String(center[1]),
    '--radius-miles',
    String(radiusMiles),
  ];
  if (bounds) {
    if (
      ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
      bounds.west < -180 ||
      bounds.east > 180 ||
      bounds.south < -90 ||
      bounds.north > 90 ||
      bounds.west >= bounds.east ||
      bounds.south >= bounds.north
    ) {
      throw new Error('Invalid import bounds');
    }
    result.push(
      '--bounds',
      String(bounds.west),
      String(bounds.south),
      String(bounds.east),
      String(bounds.north),
    );
  }
  return result;
}

const qualityCounts: Array<keyof Omit<ImportQuality, 'warnings'>> = [
  'totalAddresses',
  'assignedAddresses',
  'spatiallyAssignedAddresses',
  'inferredRoads',
  'unmatchedAddresses',
  'unresolvedClusters',
  'totalResidentialBuildings',
  'fallbackBuildings',
  'unmatchedResidentialBuildings',
  'populatedUnnamedRoads',
  'buildingAddressDisagreements',
];

function distanceToLineSquared(point: Position, line: LineString): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.coordinates.length; index += 1) {
    const start = line.coordinates[index - 1];
    const end = line.coordinates[index];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = dx * dx + dy * dy;
    const amount =
      length === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length),
          );
    const x = start[0] + amount * dx - point[0];
    const y = start[1] + amount * dy - point[1];
    best = Math.min(best, x * x + y * y);
  }
  return best;
}

function importWarnings(quality: ImportQuality, hasSegments: boolean): string[] {
  const warnings: string[] = [];
  if (quality.totalAddresses === 0 && hasSegments) {
    warnings.push('No usable address points were available for this territory.');
  } else if (
    quality.totalAddresses > 0 &&
    quality.assignedAddresses / quality.totalAddresses < 0.95
  ) {
    warnings.push(
      `Address matching is below the 95% reliability target (${(
        (quality.assignedAddresses / quality.totalAddresses) * 100
      ).toFixed(1)}% matched).`,
    );
  }
  if (quality.unmatchedResidentialBuildings > 0) {
    const count = quality.unmatchedResidentialBuildings;
    warnings.push(
      `${count} residential building ${count === 1 ? 'footprint' : 'footprints'} could not be matched to a road.`,
    );
  }
  if (quality.populatedUnnamedRoads > 0) {
    const count = quality.populatedUnnamedRoads;
    warnings.push(
      `${count} populated road ${count === 1 ? 'group still has' : 'groups still have'} no supported street name.`,
    );
  }
  if (quality.buildingAddressDisagreements > 0) {
    const count = quality.buildingAddressDisagreements;
    warnings.push(
      `${count} road ${count === 1 ? 'group has' : 'groups have'} materially different address and residential-building counts.`,
    );
  }
  return warnings;
}

export function mergeImportedTerritories(
  current: ImportedTerritoryInput,
  additions: ImportedTerritoryInput[],
  center: Position,
  radiusMiles: number,
): ImportedTerritoryInput {
  const segments = new Map(
    current.segments.map((segment) => [segment.id, structuredClone(segment)]),
  );
  const sourceSegments = new Map<string, ImportedTerritorySegment[]>();
  for (const segment of segments.values()) {
    const values = sourceSegments.get(segment.sourceSegmentId) ?? [];
    values.push(segment);
    sourceSegments.set(segment.sourceSegmentId, values);
  }
  const apartments = new Map(current.apartmentComplexes.map((item) => [item.id, item]));
  const buildings = new Map(
    current.mapBuildings.map((item) => [`${item.source}:${item.sourceId}`, item]),
  );
  const quality = structuredClone(current.quality);
  for (const addition of additions) {
    const additionsBySource = new Map<string, ImportedTerritorySegment[]>();
    for (const segment of addition.segments) {
      const values = additionsBySource.get(segment.sourceSegmentId) ?? [];
      values.push(segment);
      additionsBySource.set(segment.sourceSegmentId, values);
    }
    for (const [sourceId, incoming] of additionsBySource) {
      const existing = sourceSegments.get(sourceId);
      if (!existing) {
        const added = incoming.map((segment) => structuredClone(segment));
        for (const segment of added) segments.set(segment.id, segment);
        sourceSegments.set(sourceId, added);
        continue;
      }
      const fallbackHomes = incoming.reduce(
        (total, segment) => total + Math.max(0, segment.estimatedHomes - segment.addresses.length),
        0,
      );
      const enriched =
        incoming.find((segment) => segment.activationKind === 'automatic') ??
        incoming.find((segment) => segment.streetName !== 'Unnamed road') ??
        incoming[0];
      for (const segment of existing) {
        segment.roadClass = enriched.roadClass;
        if (enriched.streetName !== 'Unnamed road') segment.streetName = enriched.streetName;
        if (enriched.activationKind === 'automatic') segment.activationKind = 'automatic';
        if (enriched.activationKind === 'automatic' || enriched.streetName !== 'Unnamed road') {
          segment.roadGroupId = enriched.roadGroupId;
        }
      }
      const knownAddresses = new Set(
        existing.flatMap((segment) => segment.addresses.map((address) => JSON.stringify(address))),
      );
      for (const address of incoming.flatMap((segment) => segment.addresses)) {
        const key = JSON.stringify(address);
        if (knownAddresses.has(key)) continue;
        const target = existing.reduce((nearest, segment) =>
          distanceToLineSquared(address.position, segment.geometry) <
          distanceToLineSquared(address.position, nearest.geometry)
            ? segment
            : nearest,
        );
        if (target.estimatedHomes >= 100) {
          throw new Error('Incremental street merge requires full import');
        }
        target.addresses.push(address);
        target.estimatedHomes += 1;
        knownAddresses.add(key);
      }
      // ponytail: anonymous building homes are additive estimates; stable building-to-road
      // identities would be required to remove the rare seam-crossing duplicate.
      for (let index = 0; index < fallbackHomes; index += 1) {
        const target = existing.reduce((smallest, segment) =>
          segment.estimatedHomes < smallest.estimatedHomes ? segment : smallest,
        );
        target.estimatedHomes += 1;
      }
    }
    for (const apartment of addition.apartmentComplexes) {
      const existing = apartments.get(apartment.id);
      const apartmentBuilding =
        (existing?.evidence.apartmentBuilding ?? false) || apartment.evidence.apartmentBuilding;
      const distinctUnits =
        (existing?.evidence.distinctUnits ?? 0) + apartment.evidence.distinctUnits;
      apartments.set(
        apartment.id,
        existing
          ? {
              ...existing,
              address: existing.address ?? apartment.address,
              estimatedTracts: Math.max(
                existing.estimatedTracts,
                apartment.estimatedTracts,
                distinctUnits,
              ),
              evidence: {
                apartmentBuilding,
                distinctUnits,
              },
            }
          : apartment,
      );
    }
    for (const building of addition.mapBuildings) {
      buildings.set(`${building.source}:${building.sourceId}`, building);
    }
    // ponytail: edge-crossing source features can slightly overcount diagnostic quality totals;
    // persist raw features only if exact incremental quality accounting becomes operationally useful.
    for (const key of qualityCounts) quality[key] += addition.quality[key];
  }
  const latest = additions.at(-1);
  quality.warnings = importWarnings(quality, segments.size > 0);
  return {
    release: OVERTURE_RELEASE,
    center,
    radiusMiles,
    completedAt: latest?.completedAt ?? current.completedAt,
    normalizerVersion: 10,
    buildingMode:
      current.buildingMode === 'overture_fema' &&
      additions.every((addition) => addition.buildingMode === 'overture_fema')
        ? 'overture_fema'
        : 'overture_only',
    mapBuildings: [...buildings.values()],
    quality,
    apartmentComplexes: [...apartments.values()],
    segments: [...segments.values()],
  };
}

export function parseOvertureImportOutput(
  stdout: string,
  allowEmptySegments = false,
): ImportedTerritoryInput {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    failImportOutput();
  }
  if (
    !isRecord(value) ||
    !hasKeys(value, [
      'apartmentComplexes',
      'buildingMode',
      'center',
      'completedAt',
      'mapBuildings',
      'normalizerVersion',
      'quality',
      'radiusMiles',
      'release',
      'segments',
    ]) ||
    value.release !== OVERTURE_RELEASE ||
    !isGeographicPosition(value.center) ||
    !Number.isFinite(value.radiusMiles) ||
    (value.radiusMiles as number) <= 0 ||
    !isIsoTimestamp(value.completedAt) ||
    value.normalizerVersion !== 10 ||
    !isSuccessfulImportQuality(value.quality) ||
    !Array.isArray(value.apartmentComplexes) ||
    !Array.isArray(value.segments) ||
    (!allowEmptySegments && value.segments.length === 0)
  ) {
    failImportOutput();
  }
  const mapBuildings = parseMapBuildings(value.mapBuildings, value.buildingMode);

  const apartmentIds = new Set<string>();
  const apartmentComplexes = value.apartmentComplexes.map((complex): ImportedApartmentComplex => {
    if (
      !isRecord(complex) ||
      !hasKeys(complex, ['address', 'estimatedTracts', 'evidence', 'id', 'position', 'sourceId']) ||
      typeof complex.id !== 'string' ||
      complex.id.trim() === '' ||
      apartmentIds.has(complex.id) ||
      typeof complex.sourceId !== 'string' ||
      complex.sourceId.trim() === '' ||
      !isNullableString(complex.address) ||
      !isGeographicPosition(complex.position) ||
      !Number.isInteger(complex.estimatedTracts) ||
      (complex.estimatedTracts as number) < 1 ||
      !isRecord(complex.evidence) ||
      !hasKeys(complex.evidence, ['apartmentBuilding', 'distinctUnits']) ||
      typeof complex.evidence.apartmentBuilding !== 'boolean' ||
      !Number.isInteger(complex.evidence.distinctUnits) ||
      (complex.evidence.distinctUnits as number) < 0
    ) {
      failImportOutput();
    }
    apartmentIds.add(complex.id);
    return {
      id: complex.id,
      sourceId: complex.sourceId,
      address: complex.address,
      position: complex.position,
      estimatedTracts: complex.estimatedTracts as number,
      evidence: {
        apartmentBuilding: complex.evidence.apartmentBuilding,
        distinctUnits: complex.evidence.distinctUnits as number,
      },
    };
  });

  const ids = new Set<string>();
  const segments = value.segments.map((segment): ImportedTerritorySegment => {
    if (
      !isRecord(segment) ||
      !hasKeys(segment, [
        'activationKind',
        'addresses',
        'estimatedHomes',
        'geometry',
        'id',
        'roadClass',
        'roadGroupId',
        'sourceSegmentId',
        'streetName',
      ]) ||
      typeof segment.id !== 'string' ||
      segment.id.trim() === '' ||
      ids.has(segment.id) ||
      typeof segment.sourceSegmentId !== 'string' ||
      segment.sourceSegmentId.trim() === '' ||
      typeof segment.roadGroupId !== 'string' ||
      segment.roadGroupId.trim() === '' ||
      typeof segment.roadClass !== 'string' ||
      segment.roadClass.trim() === '' ||
      typeof segment.streetName !== 'string' ||
      segment.streetName.trim() === '' ||
      !Number.isInteger(segment.estimatedHomes) ||
      (segment.estimatedHomes as number) < 0 ||
      (segment.estimatedHomes as number) > 100 ||
      (segment.activationKind !== 'automatic' && segment.activationKind !== 'hidden') ||
      !Array.isArray(segment.addresses) ||
      !segment.addresses.every(isImportedAddress) ||
      !isRecord(segment.geometry) ||
      !hasKeys(segment.geometry, ['coordinates', 'type']) ||
      segment.geometry.type !== 'LineString' ||
      !Array.isArray(segment.geometry.coordinates) ||
      segment.geometry.coordinates.length < 2 ||
      !segment.geometry.coordinates.every(isGeographicPosition)
    ) {
      failImportOutput();
    }
    ids.add(segment.id);
    return {
      id: segment.id,
      sourceSegmentId: segment.sourceSegmentId,
      roadGroupId: segment.roadGroupId,
      roadClass: segment.roadClass,
      streetName: segment.streetName,
      geometry: {
        type: 'LineString',
        coordinates: segment.geometry.coordinates,
      },
      estimatedHomes: segment.estimatedHomes as number,
      activationKind: segment.activationKind,
      addresses: segment.addresses.map((address) => ({
        number: address.number,
        street: address.street,
        locality: address.locality,
        postcode: address.postcode,
        position: address.position,
      })),
    };
  });

  return {
    release: OVERTURE_RELEASE,
    center: value.center,
    radiusMiles: value.radiusMiles as number,
    completedAt: value.completedAt,
    normalizerVersion: 10,
    buildingMode: value.buildingMode as ImportedTerritoryInput['buildingMode'],
    mapBuildings,
    quality: {
      totalAddresses: value.quality.totalAddresses as number,
      assignedAddresses: value.quality.assignedAddresses as number,
      spatiallyAssignedAddresses: value.quality.spatiallyAssignedAddresses as number,
      inferredRoads: value.quality.inferredRoads as number,
      unmatchedAddresses: value.quality.unmatchedAddresses as number,
      unresolvedClusters: value.quality.unresolvedClusters as number,
      totalResidentialBuildings: value.quality.totalResidentialBuildings as number,
      fallbackBuildings: value.quality.fallbackBuildings as number,
      unmatchedResidentialBuildings: value.quality.unmatchedResidentialBuildings as number,
      populatedUnnamedRoads: value.quality.populatedUnnamedRoads as number,
      buildingAddressDisagreements: value.quality.buildingAddressDisagreements as number,
      warnings: value.quality.warnings as string[],
    },
    apartmentComplexes,
    segments,
  };
}

function readProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(new Error('Overture import timed out'));
      });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr.trim() || `Overture importer exited with code ${code}`));
        }
      });
    });
  });
}

export async function readImporterProcess(
  child: ChildProcessWithoutNullStreams,
  center: Position,
  radiusMiles: number,
  timeoutMs = IMPORT_TIMEOUT_MS,
  allowEmptySegments = false,
): Promise<ImportedTerritoryInput> {
  const imported = parseOvertureImportOutput(
    await readProcess(child, timeoutMs),
    allowEmptySegments,
  );
  if (
    Math.abs(imported.center[0] - center[0]) > IMPORT_REQUEST_TOLERANCE ||
    Math.abs(imported.center[1] - center[1]) > IMPORT_REQUEST_TOLERANCE ||
    Math.abs(imported.radiusMiles - radiusMiles) > IMPORT_REQUEST_TOLERANCE
  ) {
    throw new Error('Overture import request mismatch');
  }
  return imported;
}

export function runOvertureImport(
  center: Position,
  radiusMiles: number,
  bounds?: ImportBounds,
): Promise<ImportedTerritoryInput> {
  const executable = process.env.STREETLIGHT_PYTHON ?? 'python';
  const script = path.join(process.cwd(), 'importer', 'overture_import.py');
  const child = spawn(executable, [script, ...buildImporterArguments(center, radiusMiles, bounds)]);
  return readImporterProcess(child, center, radiusMiles, IMPORT_TIMEOUT_MS, bounds !== undefined);
}
