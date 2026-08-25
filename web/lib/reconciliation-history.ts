import {
  type CoverageCorrection,
  type CoverageRoot,
  type CoverageSegment,
  type CoverageSegmentInput,
  validateCoverageDate,
} from './coverage.ts';

export type CoverageHistoryEvent = {
  id: string;
  sequence: number;
  targetId: string;
  targetKind: 'street' | 'apartment';
  packetId: string | null;
  completionGroupId: string | null;
  coveredOn: string;
  kind: 'completed' | 'correction';
  correctsEventId: string | null;
  isVoid: boolean;
};

export type InterpretedCoverageRoot = CoverageRoot & {
  targetId: string;
  targetKind: CoverageHistoryEvent['targetKind'];
  completionGroupId: string | null;
};

export type PacketCoverageGroup = {
  packetId: string;
  completionGroupId: string;
  originalCoveredOn: string;
  effectiveCoveredOn: string | null;
  roots: InterpretedCoverageRoot[];
};

export type CoverageHistory = {
  roots: InterpretedCoverageRoot[];
  rootsByTarget: ReadonlyMap<string, InterpretedCoverageRoot[]>;
  packetGroups: ReadonlyMap<string, PacketCoverageGroup[]>;
};

function invalidHistory(): never {
  throw new Error('Invalid coverage history');
}

export function interpretCoverageHistory(
  events: CoverageHistoryEvent[],
  asOf: string,
): CoverageHistory {
  const roots = new Map<string, InterpretedCoverageRoot>();
  const eventIds = new Set<string>();
  const rootsByTarget = new Map<string, InterpretedCoverageRoot[]>();
  const packetGroups = new Map<string, Map<string, InterpretedCoverageRoot[]>>();

  for (const event of [...events].sort((first, second) => first.sequence - second.sequence)) {
    validateCoverageDate(event.coveredOn, asOf);
    if (eventIds.has(event.id) || !event.targetId) invalidHistory();
    eventIds.add(event.id);
    if ((event.packetId === null) !== (event.completionGroupId === null)) invalidHistory();

    if (event.kind === 'completed') {
      if (event.correctsEventId !== null || event.isVoid) invalidHistory();
      const root: InterpretedCoverageRoot = {
        eventId: event.id,
        packetId: event.packetId,
        completionGroupId: event.completionGroupId,
        targetId: event.targetId,
        targetKind: event.targetKind,
        originalCoveredOn: event.coveredOn,
        effectiveCoveredOn: event.coveredOn,
        corrections: [],
      };
      roots.set(event.id, root);
      const targetRoots = rootsByTarget.get(event.targetId) ?? [];
      targetRoots.push(root);
      rootsByTarget.set(event.targetId, targetRoots);
      if (event.packetId && event.completionGroupId) {
        const groups = packetGroups.get(event.packetId) ?? new Map();
        const groupRoots = groups.get(event.completionGroupId) ?? [];
        groupRoots.push(root);
        groups.set(event.completionGroupId, groupRoots);
        packetGroups.set(event.packetId, groups);
      }
      continue;
    }

    const root = event.correctsEventId ? roots.get(event.correctsEventId) : undefined;
    if (
      !root ||
      root.targetId !== event.targetId ||
      root.targetKind !== event.targetKind ||
      root.packetId !== event.packetId ||
      root.completionGroupId !== event.completionGroupId
    ) {
      invalidHistory();
    }
    const correction: CoverageCorrection = {
      id: event.id,
      sequence: event.sequence,
      coveredOn: event.coveredOn,
      isVoid: event.isVoid,
    };
    root.corrections.push(correction);
    root.effectiveCoveredOn = event.isVoid ? null : event.coveredOn;
  }

  const interpretedGroups = new Map<string, PacketCoverageGroup[]>();
  for (const [packetId, groups] of packetGroups) {
    interpretedGroups.set(
      packetId,
      [...groups].map(([completionGroupId, groupRoots]) => {
        const originals = new Set(groupRoots.map(({ originalCoveredOn }) => originalCoveredOn));
        const effective = new Set(groupRoots.map(({ effectiveCoveredOn }) => effectiveCoveredOn));
        if (originals.size !== 1 || effective.size !== 1) invalidHistory();
        return {
          packetId,
          completionGroupId,
          originalCoveredOn: groupRoots[0].originalCoveredOn,
          effectiveCoveredOn: groupRoots[0].effectiveCoveredOn,
          roots: groupRoots,
        };
      }),
    );
  }

  return {
    roots: [...roots.values()],
    rootsByTarget,
    packetGroups: interpretedGroups,
  };
}

export function projectCoverageSegments(
  history: CoverageHistory,
  inputs: CoverageSegmentInput[] = [],
): CoverageSegment[] {
  const segments = new Map<string, CoverageSegment>(
    inputs.map((input) => [input.id, { ...input, lastCoveredOn: null, roots: [] }]),
  );
  for (const root of history.roots) {
    if (!segments.has(root.targetId)) {
      segments.set(root.targetId, {
        id: root.targetId,
        estimatedHomes: 0,
        eligible: false,
        lastCoveredOn: null,
        roots: [],
      });
    }
    segments.get(root.targetId)?.roots.push({
      eventId: root.eventId,
      packetId: root.packetId,
      originalCoveredOn: root.originalCoveredOn,
      effectiveCoveredOn: root.effectiveCoveredOn,
      corrections: root.corrections,
    });
  }
  for (const segment of segments.values()) {
    segment.lastCoveredOn = segment.roots.reduce<string | null>(
      (latest, root) =>
        !root.effectiveCoveredOn || (latest && latest >= root.effectiveCoveredOn)
          ? latest
          : root.effectiveCoveredOn,
      null,
    );
  }
  return [...segments.values()];
}
