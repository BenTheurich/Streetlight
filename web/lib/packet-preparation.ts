import {
  isFinalizedBatchPayload,
  isPacketProposalPayload,
  readMutationResult,
} from './operation-state.ts';
import type {
  FinalizedBatch,
  PacketDownloadTarget,
  ReviewedPacketGenerationResult,
} from './packet-finalization.ts';

type RequestRow = { id: number; quantity: string; targetHomes: string };
type PacketFeedback = {
  detail: string;
  headline: string;
  operation: 'generation' | 'finalization' | 'download';
  recovery?: 'retry' | 'reload';
  requiresRegeneration?: boolean;
  retryTarget?: PacketDownloadTarget;
  tone: 'error' | 'success';
};
type PacketOperation =
  | { kind: 'generating' | 'finalizing' | 'refreshing' | 'uncertain' }
  | { kind: 'downloading'; target: PacketDownloadTarget };
export type PacketPreparationSnapshot = {
  rows: RequestRow[];
  customName: string;
  result: ReviewedPacketGenerationResult | null;
  confirming: boolean;
  finalized: FinalizedBatch | null;
  operation: PacketOperation | null;
  feedback: PacketFeedback | null;
};
type PacketPreparationOptions = {
  initialResult: ReviewedPacketGenerationResult | null;
  onResult: (result: ReviewedPacketGenerationResult | null) => void;
  clearSelection: () => void;
  refresh: (batch: FinalizedBatch) => Promise<void>;
  request?: typeof fetch;
  savePdf?: (blob: Blob) => void;
};

function isProposals(value: unknown): value is ReviewedPacketGenerationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.proposalFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(result.proposalFingerprint) &&
    Array.isArray(result.proposals) &&
    result.proposals.every(isPacketProposalPayload) &&
    Array.isArray(result.proposalIndexes) &&
    result.proposalIndexes.length === result.proposals.length &&
    result.proposalIndexes.every((index, position) => index === position) &&
    Array.isArray(result.warnings) &&
    result.warnings.every((warning) => typeof warning === 'string')
  );
}

function saveBrowserPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = '';
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

export function createPacketPreparation(options: PacketPreparationOptions) {
  const request = options.request ?? fetch;
  const savePdf = options.savePdf ?? saveBrowserPdf;
  const listeners = new Set<() => void>();
  let nextRowId = 1;
  let refreshNote = '';
  let snapshot: PacketPreparationSnapshot = {
    rows: [{ id: 0, quantity: '1', targetHomes: '30' }],
    customName: '',
    result: options.initialResult,
    confirming: false,
    finalized: null,
    operation: null,
    feedback: null,
  };
  function update(changes: Partial<PacketPreparationSnapshot>) {
    snapshot = { ...snapshot, ...changes };
    for (const listener of listeners) listener();
  }
  function publishResult(result: ReviewedPacketGenerationResult | null) {
    options.onResult(result);
    options.clearSelection();
    update({ result, confirming: false, finalized: null });
  }
  function requests() {
    return snapshot.rows.map(({ quantity, targetHomes }) => ({
      quantity: Number(quantity),
      targetHomes: Number(targetHomes),
    }));
  }
  async function preparePdf(target: PacketDownloadTarget) {
    update({ operation: { kind: 'downloading', target }, feedback: null });
    const parameters = new URLSearchParams(
      typeof target === 'string' ? { scope: target } : { scope: 'batch', batchId: target.batchId },
    );
    try {
      const response = await request(`/api/packets/pdf?${parameters}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Could not download the packet PDF',
        );
      }
      savePdf(await response.blob());
      const downloaded =
        typeof target === 'object'
          ? 'The finalized batch was downloaded.'
          : target === 'newest'
            ? 'The newest finalized batch was downloaded.'
            : 'All active packet sheets were downloaded.';
      update({
        feedback: {
          detail: `${downloaded}${refreshNote}`,
          headline: 'Packet PDF ready',
          operation: 'download',
          tone: 'success',
        },
      });
    } catch (error) {
      update({
        feedback: {
          detail: `${error instanceof Error ? error.message : 'Could not download the packet PDF'}. The finalized batch is still saved.${refreshNote}`,
          headline: 'Packet PDF could not be prepared',
          operation: 'download',
          retryTarget: target,
          tone: 'error',
        },
      });
    } finally {
      update({ operation: null });
    }
  }
  async function generate() {
    if (snapshot.operation) return;
    const packetRequests = requests();
    if (
      packetRequests.some(
        ({ quantity, targetHomes }) =>
          !Number.isSafeInteger(quantity) ||
          !Number.isSafeInteger(targetHomes) ||
          quantity <= 0 ||
          targetHomes <= 0,
      )
    ) {
      update({
        feedback: {
          detail: 'Enter positive whole numbers for every packet size. No request was sent.',
          headline: 'Check the packet sizes',
          operation: 'generation',
          tone: 'error',
        },
      });
      return;
    }
    update({ operation: { kind: 'generating' }, confirming: false, feedback: null });
    try {
      const response = await request('/api/packet-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: packetRequests }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isProposals(result)) {
        throw new Error(
          result &&
            typeof result === 'object' &&
            'error' in result &&
            typeof result.error === 'string'
            ? result.error
            : 'Could not generate packet proposals',
        );
      }
      publishResult(result);
      refreshNote = '';
      update({
        feedback: {
          detail: `Generated ${result.proposals.length} packet proposal${result.proposals.length === 1 ? '' : 's'} for review.`,
          headline: 'Packet proposals ready',
          operation: 'generation',
          tone: 'success',
        },
      });
    } catch (error) {
      update({
        feedback: {
          detail: `${error instanceof Error ? error.message : 'Could not generate packet proposals'}. ${snapshot.result ? 'Your previous proposals are still ready to review.' : 'Your packet sizes are still here.'}`,
          headline: 'Packet proposals could not be generated',
          operation: 'generation',
          tone: 'error',
        },
      });
    } finally {
      update({ operation: null });
    }
  }
  async function finalize() {
    if (
      snapshot.operation ||
      !snapshot.result ||
      snapshot.finalized ||
      snapshot.result.proposals.length === 0
    )
      return;
    const input = {
      requests: requests(),
      proposalFingerprint: snapshot.result.proposalFingerprint,
      proposalIndexes: snapshot.result.proposalIndexes,
      customName: snapshot.customName.trim() || null,
    };
    update({ operation: { kind: 'finalizing' }, feedback: null });
    const outcome = await readMutationResult(
      () =>
        request('/api/batches/finalize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      isFinalizedBatchPayload,
    );
    if (outcome.status !== 'success') {
      update({
        operation: outcome.status === 'uncertain' ? { kind: 'uncertain' } : null,
        feedback:
          outcome.status === 'rejected'
            ? {
                detail: `${outcome.message}. Your reviewed proposals are still here.`,
                headline: 'Packet batch was not finalized',
                operation: 'finalization',
                recovery: outcome.recovery,
                requiresRegeneration: outcome.message.includes('Generate proposals again'),
                tone: 'error',
              }
            : {
                detail:
                  'Streetlight could not confirm whether the packet batch was finalized. Your reviewed proposals are still here. Reload to verify before taking another action.',
                headline: 'Could not confirm packet finalization',
                operation: 'finalization',
                recovery: outcome.recovery,
                tone: 'error',
              },
      });
      return;
    }
    const batch = outcome.value;
    update({ finalized: batch, confirming: false, operation: { kind: 'refreshing' } });
    refreshNote = '';
    try {
      await options.refresh(batch);
    } catch {
      refreshNote = ' Reload the page to refresh the batch totals.';
    }
    await preparePdf({ batchId: batch.id });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receiveResult(result: ReviewedPacketGenerationResult | null) {
      if (snapshot.operation?.kind !== 'uncertain' && result !== snapshot.result) {
        update({ result, confirming: false });
      }
    },
    updateRow(index: number, field: 'quantity' | 'targetHomes', value: string) {
      if (snapshot.operation) return;
      update({
        rows: snapshot.rows.map((row, rowIndex) =>
          rowIndex === index ? { ...row, [field]: value } : row,
        ),
      });
      publishResult(null);
    },
    addRow() {
      if (snapshot.operation) return;
      update({ rows: [...snapshot.rows, { id: nextRowId++, quantity: '1', targetHomes: '30' }] });
      publishResult(null);
    },
    removeRow(index: number) {
      if (snapshot.operation || snapshot.rows.length < 2) return;
      update({ rows: snapshot.rows.filter((_, rowIndex) => rowIndex !== index) });
      publishResult(null);
    },
    deleteProposal(index: number) {
      if (snapshot.operation || !snapshot.result) return;
      publishResult({
        ...snapshot.result,
        proposals: snapshot.result.proposals.filter((_, proposalIndex) => proposalIndex !== index),
        proposalIndexes: snapshot.result.proposalIndexes.filter(
          (_, proposalIndex) => proposalIndex !== index,
        ),
      });
    },
    setName(customName: string) {
      if (!snapshot.operation) update({ customName });
    },
    confirm(confirming: boolean) {
      if (!snapshot.operation) update({ confirming });
    },
    generate,
    finalize,
    async download(target: PacketDownloadTarget) {
      if (!snapshot.operation) await preparePdf(target);
    },
    async retryDownload() {
      if (!snapshot.operation && snapshot.feedback?.retryTarget)
        await preparePdf(snapshot.feedback.retryTarget);
    },
  };
}
