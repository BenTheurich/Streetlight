'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { CoverageWorkspace } from '@/lib/database';
import type { FinalizedBatch, ReviewedPacketGenerationResult } from '@/lib/packet-finalization';
import { OperationStatus } from './OperationStatus';
import {
  isFinalizedBatchPayload,
  packetRequestControlsDisabled,
  readMutationResult,
} from './operation-state';
import { packetDownloadProgress } from './packet-download-progress';
import { packetToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

type PacketGeneratorProps = {
  active: boolean;
  result: ReviewedPacketGenerationResult | null;
  selectedIndex: number | null;
  latestBatch: CoverageWorkspace['latestBatch'];
  activePackets: number;
  onFinalized: (batch: FinalizedBatch) => Promise<void>;
  onResultChange: (result: ReviewedPacketGenerationResult | null) => void;
  onSelectedIndexChange: (index: number | null) => void;
  onViewChange: (view: 'generate' | 'reconcile') => void;
};

type RequestRow = {
  id: number;
  quantity: string;
  targetHomes: string;
};

type PacketFeedback = {
  detail: string;
  headline: string;
  operation: 'generation' | 'finalization' | 'download';
  recovery?: 'retry' | 'reload';
  requiresRegeneration?: boolean;
  retryScope?: 'newest' | 'active';
  tone: 'error' | 'success';
};

const initialRow: RequestRow = { id: 0, quantity: '1', targetHomes: '30' };

export function PacketGenerator({
  active,
  result,
  selectedIndex,
  latestBatch,
  activePackets,
  onFinalized,
  onResultChange,
  onSelectedIndexChange,
  onViewChange,
}: PacketGeneratorProps) {
  const [rows, setRows] = useState<RequestRow[]>([initialRow]);
  const [customName, setCustomName] = useState('');
  const [feedback, setFeedback] = useState<PacketFeedback | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [downloading, setDownloading] = useState<'newest' | 'active' | null>(null);
  const [finalized, setFinalized] = useState<FinalizedBatch | null>(null);
  const nextRowId = useRef(1);
  const finalizationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmFinalizationRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmFinalizationRef.current?.focus();
  }, [confirming]);

  function cancelFinalization(): void {
    setConfirming(false);
    requestAnimationFrame(() => finalizationTriggerRef.current?.focus());
  }

  function discardResult(): void {
    onResultChange(null);
    onSelectedIndexChange(null);
    setConfirming(false);
    setFinalized(null);
  }

  function updateRow(index: number, field: keyof RequestRow, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
    discardResult();
  }

  function requests() {
    return rows.map((row) => ({
      quantity: Number(row.quantity),
      targetHomes: Number(row.targetHomes),
    }));
  }

  function deleteProposal(index: number): void {
    if (packetOperationBusy || !result) return;
    onResultChange({
      ...result,
      proposals: result.proposals.filter((_, proposalIndex) => proposalIndex !== index),
      proposalIndexes: result.proposalIndexes.filter(
        (_, proposalIndex) => proposalIndex !== index,
      ),
    });
    onSelectedIndexChange(
      selectedIndex === index
        ? null
        : selectedIndex !== null && selectedIndex > index
          ? selectedIndex - 1
          : selectedIndex,
    );
    setConfirming(false);
    setFinalized(null);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (packetOperationBusy) return;
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
      setFeedback({
        detail: 'Enter positive whole numbers for every packet size. No request was sent.',
        headline: 'Check the packet sizes',
        operation: 'generation',
        tone: 'error',
      });
      return;
    }

    setGenerating(true);
    setConfirming(false);
    setFeedback(null);
    try {
      const response = await fetch('/api/packet-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: packetRequests }),
      });
      const next = (await response.json()) as ReviewedPacketGenerationResult | { error: string };
      if (!response.ok || 'error' in next) {
        throw new Error('error' in next ? next.error : 'Could not generate packet proposals');
      }
      onResultChange(next);
      onSelectedIndexChange(null);
      setFinalized(null);
      setFeedback({
        detail: `Generated ${next.proposals.length} packet proposal${next.proposals.length === 1 ? '' : 's'} for review.`,
        headline: 'Packet proposals ready',
        operation: 'generation',
        tone: 'success',
      });
    } catch (error) {
      setFeedback({
        detail: `${error instanceof Error ? error.message : 'Could not generate packet proposals'}. ${result ? 'Your previous proposals are still ready to review.' : 'Your packet sizes are still here.'}`,
        headline: 'Packet proposals could not be generated',
        operation: 'generation',
        tone: 'error',
      });
    } finally {
      setGenerating(false);
    }
  }

  async function finalize(): Promise<void> {
    if (packetOperationBusy) return;
    if (!result) return;
    setFinalizing(true);
    setFeedback(null);
    const outcome = await readMutationResult(
      () =>
        fetch('/api/batches/finalize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requests: requests(),
            proposalFingerprint: result.proposalFingerprint,
            proposalIndexes: result.proposalIndexes,
            customName: customName.trim() || null,
          }),
        }),
      isFinalizedBatchPayload,
    );
    if (outcome.status !== 'success') {
      if (outcome.status === 'rejected') {
        setFeedback({
          detail: `${outcome.message}. Your reviewed proposals are still here.`,
          headline: 'Packet batch was not finalized',
          operation: 'finalization',
          recovery: outcome.recovery,
          requiresRegeneration: outcome.message.includes('Generate proposals again'),
          tone: 'error',
        });
      } else {
        setFeedback({
          detail:
            'Streetlight could not confirm whether the packet batch was finalized. Your reviewed proposals are still here. Reload to verify before taking another action.',
          headline: 'Could not confirm packet finalization',
          operation: 'finalization',
          recovery: outcome.recovery,
          tone: 'error',
        });
      }
      setFinalizing(false);
      return;
    }

    const batch = outcome.value;
    setFinalized(batch);
    setConfirming(false);
    let coverageRefreshFailed = false;
    try {
      await onFinalized(batch);
    } catch {
      coverageRefreshFailed = true;
    }
    setFinalizing(false);
    await downloadPacketPdf(
      'newest',
      coverageRefreshFailed ? 'Reload the page to refresh the batch totals.' : '',
    );
  }

  async function downloadPacketPdf(scope: 'newest' | 'active', completionNote = ''): Promise<void> {
    if (packetOperationBusy) return;
    setDownloading(scope);
    setFeedback(null);
    try {
      const response = await fetch(`/api/packets/pdf?scope=${scope}`);
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || 'Could not download the packet PDF');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = '';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFeedback({
        detail:
          scope === 'newest'
            ? `The newest finalized batch was downloaded.${completionNote ? ` ${completionNote}` : ''}`
            : `All active packet sheets were downloaded.${completionNote ? ` ${completionNote}` : ''}`,
        headline: 'Packet PDF ready',
        operation: 'download',
        retryScope: scope,
        tone: 'success',
      });
    } catch (error) {
      setFeedback({
        detail: `${error instanceof Error ? error.message : 'Could not download the packet PDF'}. The finalized batch is still saved.${completionNote ? ` ${completionNote}` : ''}`,
        headline: 'Packet PDF could not be prepared',
        operation: 'download',
        retryScope: scope,
        tone: 'error',
      });
    } finally {
      setDownloading(null);
    }
  }

  const proposedHomes =
    result?.proposals.reduce((total, proposal) => total + proposal.estimatedHomes, 0) ?? 0;
  const newestPacketCount = (finalized ?? latestBatch)?.packetCount ?? 0;
  const downloadProgress = packetDownloadProgress(downloading, newestPacketCount, activePackets);
  const verificationRequired =
    feedback?.operation === 'finalization' && feedback.recovery === 'reload';
  const packetOperationBusy = packetRequestControlsDisabled({
    downloading,
    finalizing,
    generating,
    verificationRequired,
  });

  return (
    <aside className="territory-sidebar packet-sidebar tool-sidebar" hidden={!active}>
      <ToolViewSwitcher
        label="Packet workflow"
        onChange={(view) => onViewChange(view as 'generate' | 'reconcile')}
        options={packetToolViews}
        value="generate"
      />
      <div className="sidebar-scroll">
        <section>
          <h2>Packet sizes</h2>
          <form
            aria-busy={generating}
            className="packet-form"
            id="packet-request-form"
            onSubmit={(event) => void generate(event)}
          >
            {rows.map((row, index) => (
              <div className="packet-request-row" key={row.id}>
                <label>
                  Quantity
                  <input
                    disabled={packetOperationBusy}
                    min="1"
                    onChange={(event) => updateRow(index, 'quantity', event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={row.quantity}
                  />
                </label>
                <label>
                  Tracts per packet
                  <input
                    disabled={packetOperationBusy}
                    min="1"
                    onChange={(event) => updateRow(index, 'targetHomes', event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={row.targetHomes}
                  />
                </label>
                {rows.length > 1 && (
                  <button
                    aria-label={`Remove packet size ${index + 1}`}
                    className="danger packet-remove"
                    disabled={packetOperationBusy}
                    onClick={() => {
                      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
                      discardResult();
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div className="packet-form-actions">
              <button
                className="secondary"
                disabled={packetOperationBusy}
                onClick={() => {
                  setRows((current) => [
                    ...current,
                    {
                      ...initialRow,
                      id: nextRowId.current++,
                    },
                  ]);
                  discardResult();
                }}
                type="button"
              >
                Add packet size
              </button>
              <button disabled={packetOperationBusy} type="submit">
                {generating
                  ? 'Generating…'
                  : feedback?.operation === 'generation' && feedback.tone === 'error'
                    ? 'Try generation again'
                    : 'Generate proposals'}
              </button>
            </div>
            {generating ? (
              <OperationStatus
                detail="Streetlight is finding connected, overdue areas."
                headline="Generating packet proposals"
                tone="busy"
              />
            ) : (
              feedback?.operation === 'generation' && (
                <OperationStatus
                  detail={feedback.detail}
                  headline={feedback.headline}
                  tone={feedback.tone}
                />
              )
            )}
          </form>
        </section>
        {result && (
          <section className="packet-results">
            <div className="packet-results-header">
              <h2>Proposals</h2>
              <span>{result.proposals.length} ready to review</span>
            </div>
            <div className="packet-proposal-list">
              {result.proposals.map((proposal, index) => {
                const selected = index === selectedIndex;
                return (
                  <div
                    className="packet-proposal-row"
                    key={
                      proposal.kind === 'apartment'
                        ? `apartment:${proposal.apartmentId}`
                        : proposal.segments.map(({ id }) => id).join('|')
                    }
                  >
                    <article className={`packet-card${selected ? ' selected' : ''}`}>
                      <button
                        aria-expanded={selected}
                        className="packet-card-button"
                        onClick={() => onSelectedIndexChange(selected ? null : index)}
                        type="button"
                      >
                        <strong>
                          Packet {index + 1}
                          {proposal.kind === 'apartment' ? ' · Apartment complex' : ''}
                        </strong>
                        <span>
                          Target {proposal.targetHomes} tract
                          {proposal.targetHomes === 1 ? '' : 's'}
                        </span>
                        <span>
                          {proposal.estimatedHomes} estimated tract
                          {proposal.estimatedHomes === 1 ? '' : 's'}
                        </span>
                      </button>
                      {selected && (
                        <div className="packet-card-detail">
                          <strong>
                            {proposal.kind === 'apartment' ? 'Complex address' : 'Starting address'}
                          </strong>
                          <p>{proposal.start.address}</p>
                          {proposal.kind !== 'apartment' && (
                            <>
                              <strong>Streets</strong>
                              <p>{proposal.streetNames.join(', ')}</p>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                    <button
                      aria-label={`Delete Packet ${index + 1} proposal`}
                      className="danger packet-proposal-delete"
                      disabled={packetOperationBusy}
                      onClick={() => deleteProposal(index)}
                      title={`Delete Packet ${index + 1} proposal`}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
            {result.warnings.map((warning) => (
              <p className="packet-warning" key={warning}>
                {warning}
              </p>
            ))}
            {!finalized && result.proposals.length > 0 && (
              <div className="packet-finalize">
                <label>
                  <span className="packet-finalize-label">
                    Batch name <small>(optional)</small>
                  </span>
                  <input
                    disabled={packetOperationBusy}
                    maxLength={80}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder="Streetlight will name it automatically"
                    value={customName}
                  />
                </label>
                {!confirming ? (
                  <button
                    disabled={packetOperationBusy}
                    onClick={() => setConfirming(true)}
                    ref={finalizationTriggerRef}
                    type="button"
                  >
                    Finalize &amp; download
                  </button>
                ) : (
                  <div className="packet-confirmation">
                    <strong>Finalize this batch?</strong>
                    <p>
                      {result.proposals.length} packet
                      {result.proposals.length === 1 ? '' : 's'} · {proposedHomes} estimated tract
                      {proposedHomes === 1 ? '' : 's'}
                    </p>
                    <p>These streets and apartment complexes will be reserved for this outreach.</p>
                    <div>
                      <button
                        className="secondary"
                        disabled={packetOperationBusy}
                        onClick={cancelFinalization}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={packetOperationBusy}
                        form={feedback?.requiresRegeneration ? 'packet-request-form' : undefined}
                        onClick={feedback?.requiresRegeneration ? undefined : () => void finalize()}
                        ref={confirmFinalizationRef}
                        type={feedback?.requiresRegeneration ? 'submit' : 'button'}
                      >
                        {finalizing
                          ? 'Finalizing…'
                          : feedback?.requiresRegeneration
                            ? 'Generate proposals again'
                            : feedback?.operation === 'finalization' && feedback.tone === 'error'
                              ? 'Try finalization again'
                              : 'Confirm finalization'}
                      </button>
                    </div>
                    {finalizing ? (
                      <OperationStatus
                        detail="Streetlight is reserving this batch before preparing its PDF."
                        headline="Finalizing packet batch"
                        tone="busy"
                      />
                    ) : (
                      feedback?.operation === 'finalization' && (
                        <OperationStatus
                          action={
                            feedback.recovery === 'reload' ? (
                              <button onClick={() => window.location.reload()} type="button">
                                Reload to verify
                              </button>
                            ) : undefined
                          }
                          detail={feedback.detail}
                          headline={feedback.headline}
                          tone={feedback.tone}
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
      {(latestBatch || finalized) && (
        <div aria-busy={downloadProgress.busy} className="packet-downloads">
          {downloadProgress.message && downloadProgress.headline ? (
            <OperationStatus
              detail={downloadProgress.message}
              headline={downloadProgress.headline}
              tone="busy"
            />
          ) : (
            feedback?.operation === 'download' && (
              <OperationStatus
                detail={feedback.detail}
                headline={feedback.headline}
                tone={feedback.tone}
              />
            )
          )}
          <button
            disabled={packetOperationBusy}
            onClick={() => void downloadPacketPdf('newest')}
            type="button"
          >
            {downloading === 'newest'
              ? 'Downloading…'
              : feedback?.operation === 'download' &&
                  feedback.tone === 'error' &&
                  feedback.retryScope === 'newest'
                ? 'Try newest batch again'
                : 'Download newest batch'}
          </button>
          <button
            className="secondary"
            disabled={packetOperationBusy || activePackets === 0}
            onClick={() => void downloadPacketPdf('active')}
            type="button"
          >
            {downloading === 'active'
              ? 'Downloading…'
              : feedback?.operation === 'download' &&
                  feedback.tone === 'error' &&
                  feedback.retryScope === 'active'
                ? `Try all active packets again (${activePackets})`
                : `Download all active packets (${activePackets})`}
          </button>
        </div>
      )}
    </aside>
  );
}
