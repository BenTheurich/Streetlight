import type { PacketProposal } from './packet-selection.ts';
import type { Position } from './territory-geometry.ts';

export type ReconciliationOutcome = 'still-here' | 'taken' | 'discarded';

export type PacketCoverageHistory = {
  completionGroupId: string;
  originalCoveredOn: string;
  effectiveCoveredOn: string | null;
};

export type ReconciliationPacket = {
  id: string;
  code: string;
  kind: 'street' | 'apartment';
  status: 'active' | 'completed' | 'cancelled';
  estimatedTracts: number;
  start: { address: string; position: Position };
  segments: PacketProposal['segments'];
  apartment: { id: string; position: Position } | null;
  completedOn: string | null;
  history: PacketCoverageHistory[];
};

export type ReconciliationBatch = {
  id: string;
  name: string;
  status: 'draft' | 'finalized' | 'reconciled' | 'cancelled';
  finalizedAt: string | null;
  packets: ReconciliationPacket[];
  counts: { active: number; completed: number; cancelled: number };
};

export type ReconciliationWorkspace = {
  asOf: string;
  defaultBatchId: string | null;
  batches: ReconciliationBatch[];
};

export type ReconciliationView = 'active' | 'history';
export type ReconciliationHistoryTarget = { packetId: string };

export type ReconciliationDecision = {
  packetId: string;
  outcome: ReconciliationOutcome;
};

export type ReconciliationSubmission = {
  batchId: string;
  decisions: ReconciliationDecision[];
};

export type ReconciliationDraft = {
  batchId: string | null;
  outcomes: ReadonlyMap<string, ReconciliationOutcome>;
  selectedPacketId: string | null;
  view: ReconciliationView;
  historyTarget?: ReconciliationHistoryTarget | null;
};

export type ReconciliationMapPacket = {
  packet: ReconciliationPacket;
  disposition: 'active' | 'complete' | 'cancel';
  selected: boolean;
};

export type ReconciliationMapPresentation = {
  focusKey: string | null;
  packets: ReconciliationMapPacket[];
};

export type ReconciliationProjection = {
  activeBatches: ReconciliationBatch[];
  historyBatches: ReconciliationBatch[];
  visibleBatches: ReconciliationBatch[];
  batch: ReconciliationBatch | null;
  activePackets: ReconciliationPacket[];
  historyPackets: ReconciliationPacket[];
  selectedPacketId: string | null;
  targetSelection: { batchId: string; packetId: string } | null;
  view: ReconciliationView;
  review: { unreviewed: string[]; active: string[]; complete: string[]; cancel: string[] };
  submission: ReconciliationSubmission | null;
  map: ReconciliationMapPresentation;
};

function batchesForView(
  batches: ReconciliationBatch[],
  view: ReconciliationView,
): ReconciliationBatch[] {
  return batches.filter((batch) =>
    view === 'active'
      ? batch.counts.active > 0
      : batch.counts.completed + batch.counts.cancelled > 0,
  );
}

function targetSelection(
  batches: ReconciliationBatch[],
  target: ReconciliationHistoryTarget | null | undefined,
): { batchId: string; packetId: string } | null {
  if (!target) return null;
  const batch = batches.find(({ packets }) =>
    packets.some((packet) => packet.id === target.packetId && packet.status !== 'active'),
  );
  return batch ? { batchId: batch.id, packetId: target.packetId } : null;
}

function preferredBatchId(
  batches: ReconciliationBatch[],
  requested: string | null,
  fallback: string | null,
): string | null {
  if (requested && batches.some(({ id }) => id === requested)) return requested;
  if (fallback && batches.some(({ id }) => id === fallback)) return fallback;
  return batches[0]?.id ?? null;
}

export function projectReconciliation(
  workspace: ReconciliationWorkspace,
  draft: ReconciliationDraft,
): ReconciliationProjection {
  const activeBatches = batchesForView(workspace.batches, 'active');
  const historyBatches = batchesForView(workspace.batches, 'history');
  const target = targetSelection(workspace.batches, draft.historyTarget);
  const view = target ? 'history' : draft.view;
  const visibleBatches = view === 'active' ? activeBatches : historyBatches;
  const batchId = preferredBatchId(
    visibleBatches,
    target?.batchId ?? draft.batchId,
    view === 'active' ? workspace.defaultBatchId : null,
  );
  const batch = visibleBatches.find(({ id }) => id === batchId) ?? null;
  const activePackets = batch?.packets.filter(({ status }) => status === 'active') ?? [];
  const historyPackets = batch?.packets.filter(({ status }) => status !== 'active') ?? [];
  const selectedCandidate = target?.packetId ?? draft.selectedPacketId;
  const packetsForView = view === 'active' ? activePackets : historyPackets;
  const selectedPacketId = packetsForView.some(({ id }) => id === selectedCandidate)
    ? selectedCandidate
    : null;
  const review = {
    unreviewed: activePackets.filter(({ id }) => !draft.outcomes.has(id)).map(({ id }) => id),
    active: activePackets
      .filter(({ id }) => draft.outcomes.get(id) === 'still-here')
      .map(({ id }) => id),
    complete: activePackets
      .filter(({ id }) => draft.outcomes.get(id) === 'taken')
      .map(({ id }) => id),
    cancel: activePackets
      .filter(({ id }) => draft.outcomes.get(id) === 'discarded')
      .map(({ id }) => id),
  };
  const submission =
    view === 'active' && batch && activePackets.length > 0 && review.unreviewed.length === 0
      ? {
          batchId: batch.id,
          decisions: activePackets.map(({ id }) => ({
            packetId: id,
            outcome: draft.outcomes.get(id) as ReconciliationOutcome,
          })),
        }
      : null;
  const visibleMapPackets = selectedPacketId
    ? packetsForView.filter(({ id }) => id === selectedPacketId)
    : packetsForView;
  const mapPackets = visibleMapPackets.map((packet): ReconciliationMapPacket => {
    const outcome = draft.outcomes.get(packet.id);
    return {
      packet,
      disposition:
        packet.status === 'cancelled' || outcome === 'discarded'
          ? 'cancel'
          : packet.status === 'completed' || outcome === 'taken'
            ? 'complete'
            : 'active',
      selected: packet.id === selectedPacketId,
    };
  });

  return {
    activeBatches,
    historyBatches,
    visibleBatches,
    batch,
    activePackets,
    historyPackets,
    selectedPacketId,
    targetSelection: target,
    view,
    review,
    submission,
    map: {
      focusKey: batch ? `${batch.id}:${selectedPacketId ?? 'all'}` : null,
      packets: mapPackets,
    },
  };
}
