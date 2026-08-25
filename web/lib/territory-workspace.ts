import type { ImportedMapBuilding } from './overture-import.ts';
import type { LineString, Position } from './territory-geometry.ts';
import type { TerritoryImportMetadata } from './territory-import.ts';

export type TerritorySegment = {
  id: string;
  sourceSegmentId: string;
  roadGroupId: string;
  roadClass: string;
  streetName: string;
  geometry: LineString;
  estimatedHomes: number;
  activationKind: 'automatic' | 'hidden' | 'manual';
  active: boolean;
  withinBoundary: boolean;
  manuallyExcluded: boolean;
  eligible: boolean;
  excludedReason: 'hidden' | 'boundary' | 'segment' | null;
};

export type ApartmentEvidence = {
  id: string;
  sourceId: string;
  address: string | null;
  position: Position;
  geometry: ImportedMapBuilding['geometry'] | null;
  apartmentBuilding: boolean;
  distinctUnits: number;
};

export type ApartmentSite = {
  id: string;
  sourceId: string;
  name: string | null;
  address: string | null;
  position: Position;
  boundary: ImportedMapBuilding['geometry'] | null;
  groupingKind: 'source_boundary' | 'ungrouped' | 'admin_group';
  groupingConfirmed: boolean;
  addressConfirmed: boolean;
  tractCount: number | null;
  accessStatus: 'unknown' | 'open' | 'restricted';
  includedInPackets: boolean;
  packetReady: boolean;
  members: ApartmentEvidence[];
  estimatedTracts: number;
  evidence: { apartmentBuilding: boolean; distinctUnits: number };
  reviewStatus: 'needs_review' | 'ready' | 'deferred';
  withinBoundary: boolean;
};

export class ApartmentSiteError extends Error {
  readonly code: 'not_found' | 'invalid' | 'not_ready' | 'member_conflict';

  constructor(code: 'not_found' | 'invalid' | 'not_ready' | 'member_conflict', message: string) {
    super(message);
    this.code = code;
  }
}

export type ApartmentSiteConfigurationInput = {
  id: string;
  name: string | null;
  address: string | null;
  addressConfirmed: boolean;
  tractCount: number | null;
  accessStatus: 'unknown' | 'open' | 'restricted';
  groupingConfirmed: boolean;
  includedInPackets: boolean;
};

export type ApartmentSiteMembershipInput = {
  id: string | null;
  memberIds: string[];
};

export type TerritoryWorkspace = {
  id: string;
  churchName: string;
  name: string;
  originAddress: string;
  center: Position;
  radiusMiles: number;
  boundaryShape: 'circle' | 'square';
  import: TerritoryImportMetadata;
  apartmentSites: ApartmentSite[];
  apartmentComplexes: ApartmentSite[];
  segments: TerritorySegment[];
  totals: {
    allSegments: number;
    eligibleSegments: number;
    allHomes: number;
    eligibleHomes: number;
  };
};
