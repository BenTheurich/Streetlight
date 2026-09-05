'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CoverageWorkspace } from '@/lib/coverage';
import type { FinalizedBatch, ReviewedPacketGenerationResult } from '@/lib/packet-finalization';
import { createPacketPreparation } from '@/lib/packet-preparation';
import { APARTMENTS_ENABLED } from '@/lib/product-capabilities';
import { OperationStatus } from './OperationStatus';
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

export function PacketGenerator({
  active,
  result: externalResult,
  selectedIndex,
  latestBatch,
  activePackets,
  onFinalized,
  onResultChange,
  onSelectedIndexChange,
  onViewChange,
}: PacketGeneratorProps) {
  const callbacks = useRef({ onFinalized, onResultChange, onSelectedIndexChange });
  callbacks.current = { onFinalized, onResultChange, onSelectedIndexChange };
  const [workflow] = useState(() =>
    createPacketPreparation({
      initialResult: externalResult,
      onResult: (result) => callbacks.current.onResultChange(result),
      clearSelection: () => callbacks.current.onSelectedIndexChange(null),
      refresh: (batch) => callbacks.current.onFinalized(batch),
    }),
  );
  const { rows, customName, result, confirming, finalized, operation, feedback } =
    useSyncExternalStore(workflow.subscribe, workflow.getSnapshot, workflow.getSnapshot);
  useEffect(() => {
    workflow.receiveResult(externalResult);
  }, [externalResult, workflow]);
  const finalizationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmFinalizationRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmFinalizationRef.current?.focus();
  }, [confirming]);
  function cancelFinalization(): void {
    workflow.confirm(false);
    requestAnimationFrame(() => finalizationTriggerRef.current?.focus());
  }
  const locked = operation !== null;
  const generating = operation?.kind === 'generating';
  const finalizing = operation?.kind === 'finalizing';
  const downloading =
    operation?.kind === 'downloading'
      ? typeof operation.target === 'string'
        ? operation.target
        : 'batch'
      : null;
  const proposedHomes =
    result?.proposals.reduce((total, proposal) => total + proposal.estimatedHomes, 0) ?? 0;
  const newestPacketCount = (finalized ?? latestBatch)?.packetCount ?? 0;
  const downloadProgress = packetDownloadProgress(downloading, newestPacketCount, activePackets);

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
            onSubmit={(event) => {
              event.preventDefault();
              void workflow.generate();
            }}
          >
            {rows.map((row, index) => (
              <div className="packet-request-row" key={row.id}>
                <label>
                  Quantity
                  <input
                    disabled={locked}
                    min="1"
                    onChange={(event) => workflow.updateRow(index, 'quantity', event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={row.quantity}
                  />
                </label>
                <label>
                  Tracts per packet
                  <input
                    disabled={locked}
                    min="1"
                    onChange={(event) =>
                      workflow.updateRow(index, 'targetHomes', event.target.value)
                    }
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
                    disabled={locked}
                    onClick={() => workflow.removeRow(index)}
                    title={`Remove packet size ${index + 1}`}
                    type="button"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <div className="packet-form-actions">
              <button
                className="secondary"
                disabled={locked}
                onClick={() => workflow.addRow()}
                type="button"
              >
                Add packet size
              </button>
              <button disabled={locked} type="submit">
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
                  <article
                    className={`packet-card${selected ? ' selected' : ''}`}
                    key={
                      proposal.kind === 'apartment'
                        ? `apartment:${proposal.apartmentId}`
                        : proposal.segments.map(({ id }) => id).join('|')
                    }
                  >
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
                    <button
                      aria-label={`Delete Packet ${index + 1} proposal`}
                      className="packet-proposal-delete"
                      disabled={locked}
                      onClick={() => workflow.deleteProposal(index)}
                      title={`Delete Packet ${index + 1} proposal`}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                      </svg>
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
                    disabled={locked}
                    maxLength={80}
                    onChange={(event) => workflow.setName(event.target.value)}
                    placeholder="Streetlight will name it automatically"
                    value={customName}
                  />
                </label>
                {!confirming ? (
                  <button
                    disabled={locked}
                    onClick={() => workflow.confirm(true)}
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
                    <p>
                      These streets{APARTMENTS_ENABLED ? ' and apartment complexes' : ''} will be
                      reserved for this outreach.
                    </p>
                    <div>
                      <button
                        className="secondary"
                        disabled={locked}
                        onClick={cancelFinalization}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={locked}
                        form={feedback?.requiresRegeneration ? 'packet-request-form' : undefined}
                        onClick={
                          feedback?.requiresRegeneration
                            ? undefined
                            : () => void workflow.finalize()
                        }
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
          {operation?.kind === 'refreshing' ? (
            <OperationStatus
              detail="Refreshing saved batch totals before preparing its PDF."
              headline="Packet batch finalized"
              tone="busy"
            />
          ) : downloadProgress.message && downloadProgress.headline ? (
            <OperationStatus
              detail={downloadProgress.message}
              headline={downloadProgress.headline}
              tone="busy"
            />
          ) : (
            feedback?.operation === 'download' && (
              <OperationStatus
                action={
                  typeof feedback.retryTarget === 'object' ? (
                    <button
                      disabled={locked}
                      onClick={() => void workflow.retryDownload()}
                      type="button"
                    >
                      Try this batch again
                    </button>
                  ) : undefined
                }
                detail={feedback.detail}
                headline={feedback.headline}
                tone={feedback.tone}
              />
            )
          )}
          <button disabled={locked} onClick={() => void workflow.download('newest')} type="button">
            {downloading === 'newest'
              ? 'Downloading…'
              : feedback?.operation === 'download' &&
                  feedback.tone === 'error' &&
                  feedback.retryTarget === 'newest'
                ? 'Try newest batch again'
                : 'Download newest batch'}
          </button>
          <button
            className="secondary"
            disabled={locked || activePackets === 0}
            onClick={() => void workflow.download('active')}
            type="button"
          >
            {downloading === 'active'
              ? 'Downloading…'
              : feedback?.operation === 'download' &&
                  feedback.tone === 'error' &&
                  feedback.retryTarget === 'active'
                ? `Try all active packets again (${activePackets})`
                : `Download all active packets (${activePackets})`}
          </button>
        </div>
      )}
    </aside>
  );
}
