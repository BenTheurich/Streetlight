import { createHash } from 'node:crypto';
import type { ImportedMapBuilding } from './overture-import.ts';
import type {
  PacketGenerationResult,
  PacketProposal,
  PacketSizeRequest,
} from './packet-selection.ts';
import { parsePacketSizeRequests } from './packet-selection.ts';
import type { Position } from './territory-geometry.ts';

export type PacketFinalizationInput = {
  requests: PacketSizeRequest[];
  proposalFingerprint: string;
  proposalIndexes: number[];
  customName: string | null;
};

export type ReviewedPacketGenerationResult = PacketGenerationResult & {
  proposalFingerprint: string;
  proposalIndexes: number[];
};

export type FinalizedPacket = PacketProposal & {
  id: string;
  code: string;
};

export type FinalizedBatch = {
  id: string;
  name: string;
  finalizedAt: string;
  packetCount: number;
  estimatedHomes: number;
  packets: FinalizedPacket[];
};

export type DownloadPacket = {
  kind: 'street' | 'apartment';
  apartmentId: string | null;
  accessStatus: 'open' | 'restricted' | null;
  id: string;
  code: string;
  batchId: string;
  batchName: string;
  importGeneration: number;
  estimatedHomes: number;
  start: { address: string; position: Position };
  segments: Array<{
    id: string;
    streetName: string;
    roadClass: string;
    geometry: PacketProposal['segments'][number]['geometry'];
    estimatedHomes: number;
  }>;
};

export type PacketMapGeneration = {
  importGeneration: number;
  overtureRelease: string;
  networkSegments: Array<{
    id: string;
    streetName: string;
    roadClass: string;
    geometry: PacketProposal['segments'][number]['geometry'];
  }>;
  buildings: Array<
    ImportedMapBuilding & {
      address?: { number: string; street: string };
    }
  >;
  houseNumbers: Array<{ number: string; street: string; position: Position }>;
};

export type PacketDownloadSelection = {
  scope: 'newest' | 'active' | 'batch';
  packets: DownloadPacket[];
  mapGenerations: PacketMapGeneration[];
};

export type PacketDownloadTarget = 'newest' | 'active' | { batchId: string };

export class PacketProposalConflictError extends Error {}

export function parsePacketFinalizationInput(value: unknown): PacketFinalizationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid finalization request');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(',') !==
      'customName,proposalFingerprint,proposalIndexes,requests' ||
    typeof input.proposalFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.proposalFingerprint) ||
    !Array.isArray(input.proposalIndexes) ||
    input.proposalIndexes.length === 0 ||
    input.proposalIndexes.some(
      (index, position, indexes) =>
        !Number.isSafeInteger(index) ||
        (index as number) < 0 ||
        (position > 0 && (index as number) <= (indexes[position - 1] as number)),
    ) ||
    !(
      input.customName === null ||
      (typeof input.customName === 'string' && input.customName.trim().length <= 80)
    )
  ) {
    throw new Error('Invalid finalization request');
  }
  return {
    requests: parsePacketSizeRequests(input.requests),
    proposalFingerprint: input.proposalFingerprint,
    proposalIndexes: input.proposalIndexes as number[],
    customName: input.customName,
  };
}

export function packetProposalFingerprint(proposals: PacketProposal[]): string {
  const stable = proposals.map((proposal) => ({
    kind: proposal.kind ?? 'street',
    apartmentId: proposal.apartmentId ?? null,
    accessStatus: proposal.accessStatus ?? null,
    targetHomes: proposal.targetHomes,
    estimatedHomes: proposal.estimatedHomes,
    coverageClass: proposal.coverageClass,
    segments: proposal.segments.map(({ id, estimatedHomes, geometry }) => ({
      id,
      estimatedHomes,
      coordinates: geometry.coordinates,
    })),
    start: proposal.start,
    streetNames: proposal.streetNames,
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function withProposalFingerprint(
  result: PacketGenerationResult,
): ReviewedPacketGenerationResult {
  return {
    ...result,
    proposalFingerprint: packetProposalFingerprint(result.proposals),
    proposalIndexes: result.proposals.map((_, index) => index),
  };
}
