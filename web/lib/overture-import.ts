import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import type { LineString, Polygon, Position } from './territory-geometry.ts';
import { OVERTURE_RELEASE } from './territory-import.ts';

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
  normalizerVersion: 11;
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

export function buildImporterArguments(center: Position, radiusMiles: number): string[] {
  if (!isGeographicPosition(center)) {
    throw new Error('Invalid import center');
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    throw new Error('Invalid import radius');
  }
  return [
    '--longitude',
    String(center[0]),
    '--latitude',
    String(center[1]),
    '--radius-miles',
    String(radiusMiles),
  ];
}

export function parseOvertureImportOutput(stdout: string): ImportedTerritoryInput {
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
    value.normalizerVersion !== 11 ||
    !isSuccessfulImportQuality(value.quality) ||
    !Array.isArray(value.apartmentComplexes) ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0
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
    normalizerVersion: 11,
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
): Promise<ImportedTerritoryInput> {
  const imported = parseOvertureImportOutput(await readProcess(child, timeoutMs));
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
): Promise<ImportedTerritoryInput> {
  const executable = process.env.STREETLIGHT_PYTHON ?? 'python';
  const script = path.join(process.cwd(), 'importer', 'overture_import.py');
  const child = spawn(executable, [script, ...buildImporterArguments(center, radiusMiles)]);
  return readImporterProcess(child, center, radiusMiles);
}
