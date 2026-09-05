import type { ImportedMapBuilding } from './overture-import.ts';
import type { Polygon, Position } from './territory-geometry.ts';

export type OpenMapData = {
  churchId: string;
  territoryId: string;
  territoryName: string;
  center: Position;
  bounds: [number, number, number, number];
  boundary: Polygon;
  importGeneration: number;
  overtureRelease: string;
  buildingMode: 'overture_fema' | 'overture_only';
  buildings: Array<ImportedMapBuilding & { address?: { number: string; street: string } }>;
  houseNumbers: Array<{ number: string; street: string; position: Position }>;
  attribution: {
    base: string;
    roads: string;
    buildings: string;
    fema: string | null;
  };
};
