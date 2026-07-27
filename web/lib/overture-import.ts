import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import type { LineString, Position } from './territory-geometry.ts';
import { OVERTURE_RELEASE } from './territory-import.ts';

const ROAD_CLASSES = new Set([
  'living_street',
  'primary',
  'residential',
  'secondary',
  'tertiary',
  'unclassified',
]);

export type ImportedTerritorySegment = {
  id: string;
  sourceSegmentId: string;
  roadClass: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
};

export type ImportedTerritoryInput = {
  release: typeof OVERTURE_RELEASE;
  center: Position;
  radiusMiles: number;
  completedAt: string;
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

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
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
    !hasKeys(value, ['center', 'completedAt', 'radiusMiles', 'release', 'segments']) ||
    value.release !== OVERTURE_RELEASE ||
    !isGeographicPosition(value.center) ||
    !Number.isFinite(value.radiusMiles) ||
    (value.radiusMiles as number) <= 0 ||
    !isIsoTimestamp(value.completedAt) ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0
  ) {
    failImportOutput();
  }

  const ids = new Set<string>();
  const segments = value.segments.map((segment): ImportedTerritorySegment => {
    if (
      !isRecord(segment) ||
      !hasKeys(segment, [
        'estimatedHomes',
        'geometry',
        'id',
        'roadClass',
        'sourceSegmentId',
        'streetName',
      ]) ||
      typeof segment.id !== 'string' ||
      segment.id.trim() === '' ||
      ids.has(segment.id) ||
      typeof segment.sourceSegmentId !== 'string' ||
      segment.sourceSegmentId.trim() === '' ||
      typeof segment.roadClass !== 'string' ||
      !ROAD_CLASSES.has(segment.roadClass) ||
      typeof segment.streetName !== 'string' ||
      segment.streetName.trim() === '' ||
      !Number.isInteger(segment.estimatedHomes) ||
      (segment.estimatedHomes as number) < 0 ||
      !isRecord(segment.geometry) ||
      !hasKeys(segment.geometry, ['coordinates', 'type']) ||
      segment.geometry.type !== 'LineString' ||
      !Array.isArray(segment.geometry.coordinates) ||
      segment.geometry.coordinates.length < 2 ||
      !segment.geometry.coordinates.every(isPosition)
    ) {
      failImportOutput();
    }
    ids.add(segment.id);
    return {
      id: segment.id,
      sourceSegmentId: segment.sourceSegmentId,
      roadClass: segment.roadClass,
      streetName: segment.streetName,
      geometry: {
        type: 'LineString',
        coordinates: segment.geometry.coordinates,
      },
      estimatedHomes: segment.estimatedHomes as number,
    };
  });

  return {
    release: OVERTURE_RELEASE,
    center: value.center,
    radiusMiles: value.radiusMiles as number,
    completedAt: value.completedAt,
    segments,
  };
}

function readProcess(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `Overture importer exited with code ${code}`));
      }
    });
  });
}

export async function readImporterProcess(
  child: ChildProcessWithoutNullStreams,
): Promise<ImportedTerritoryInput> {
  return parseOvertureImportOutput(await readProcess(child));
}

export function runOvertureImport(
  center: Position,
  radiusMiles: number,
): Promise<ImportedTerritoryInput> {
  const executable = process.env.STREETLIGHT_PYTHON ?? 'python';
  const script = path.join(process.cwd(), 'importer', 'overture_import.py');
  const child = spawn(executable, [script, ...buildImporterArguments(center, radiusMiles)]);
  return readImporterProcess(child);
}
