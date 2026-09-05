'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import { type CorrectionAttempt, correctionControlForPacket } from '@/lib/operation-state';
import type {
  ReconciliationBatchSummary,
  ReconciliationHistoryTarget,
  ReconciliationPacket,
} from '@/lib/reconciliation';
import { createReconciliationWorkflow } from '@/lib/reconciliation-workflow';
import { OpenReconciliationOverlay } from './OpenReconciliationOverlay';
import { OperationStatus } from './OperationStatus';
import { StreetlightSelect } from './StreetlightSelect';
import { packetToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function batchOptionLabel(batch: ReconciliationBatchSummary): string {
  const automaticPrefix = 'Outreach batch - ';
  const historyPrefix = 'Outreach history - ';
  const automaticTimestamp = batch.name.startsWith(automaticPrefix)
    ? batch.name.slice(automaticPrefix.length)
    : null;
  const name = automaticTimestamp
    ? 'Outreach batch'
    : batch.name.startsWith(historyPrefix)
      ? 'Outreach history'
      : batch.name;
  const timestamp =
    automaticTimestamp ??
    (batch.finalizedAt
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(batch.finalizedAt))
      : 'Not finalized');
  return `${name} · ${timestamp} · ${batch.counts.active} active`;
}

function historyBatchOptionLabel(batch: ReconciliationBatchSummary): string {
  return batchOptionLabel(batch).replace(
    /\d+ active$/,
    `${batch.counts.completed + batch.counts.cancelled} records`,
  );
}

export function ReconciliationTool({
  active,
  lifecycle,
  onChanged,
  onTargetHandled,
  onViewChange,
  target,
}: {
  active: boolean;
  lifecycle: MapOverlayLifecycle | null;
  onChanged: () => Promise<void>;
  onTargetHandled: () => void;
  onViewChange: (view: 'generate' | 'reconcile') => void;
  target: ReconciliationHistoryTarget | null;
}) {
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const [workflow] = useState(() =>
    createReconciliationWorkflow({
      onAccepted: () => onChangedRef.current(),
    }),
  );
  const snapshot = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
    workflow.getSnapshot,
  );
  const selectedPacketRef = useRef<HTMLElement | null>(null);
  const ready = snapshot.kind === 'ready' ? snapshot : null;
  const workspace = ready?.accepted ?? null;
  const projection = ready?.projection ?? null;
  const batchId = ready?.draft.batchId ?? null;
  const packetOutcomes = ready?.draft.outcomes ?? new Map();
  const selectedPacketId = ready?.draft.selectedPacketId ?? null;
  const editingPacketId = ready?.draft.editingPacketId ?? null;
  const reconciliationView = ready?.draft.view ?? 'active';
  const reviewing = ready?.draft.reviewing ?? false;
  const operation = ready?.operation ?? null;
  const feedback = ready?.feedback ?? null;
  const loading = snapshot.kind === 'idle' || snapshot.kind === 'loading';
  const busy = operation !== null;
  const mutationControlsDisabled = ready?.mutationControlsDisabled ?? false;

  useEffect(() => {
    if (active) void workflow.act({ kind: 'load' });
  }, [active, workflow]);

  useEffect(() => {
    if (!active || !ready || ready.mutationControlsDisabled || !target) return;
    void workflow.act({ kind: 'target', target });
    onTargetHandled();
  }, [active, onTargetHandled, ready, target, workflow]);

  useEffect(() => {
    if (!active || reconciliationView !== 'history' || !selectedPacketId) return;
    const frame = requestAnimationFrame(() =>
      selectedPacketRef.current?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, reconciliationView, selectedPacketId]);
  const activeBatches = projection?.activeBatches ?? [];
  const historyBatches = projection?.historyBatches ?? [];
  const visibleBatches = projection?.visibleBatches ?? [];
  const batch = projection?.batch ?? null;
  const activePackets = projection?.activePackets ?? [];
  const historyPackets = projection?.historyPackets ?? [];
  const preview = projection?.review ?? {
    unreviewed: [],
    active: [],
    complete: [],
    cancel: [],
  };
  const reviewReady = projection?.submission != null;
  const packetById = new Map(batch?.packets.map((packet) => [packet.id, packet]) ?? []);

  async function confirm(): Promise<void> {
    await workflow.act(
      feedback?.operation === 'confirm' && feedback.tone === 'error'
        ? { kind: 'recover', operation: 'confirm' }
        : { kind: 'confirm' },
    );
  }

  async function correct(attempt: CorrectionAttempt): Promise<void> {
    await workflow.act({ kind: 'correct', attempt });
  }

  function correctionStatus(packet: ReconciliationPacket) {
    const control = correctionControlForPacket(
      packet.id,
      operation?.kind === 'correction' ? operation.attempt : null,
      feedback?.operation === 'correction' ? feedback : null,
    );
    const correctionFeedback = control.feedback;
    const retryAttempt = control.action?.kind === 'retry' ? control.action.attempt : null;

    if (control.busy) {
      return (
        <OperationStatus
          detail="Streetlight is updating this whole packet while keeping its history."
          headline="Updating packet history"
          tone="busy"
        />
      );
    }
    if (!correctionFeedback) return null;

    return (
      <OperationStatus
        action={
          control.action?.kind === 'reload' ? (
            <button
              onClick={() =>
                void workflow.act({
                  kind: 'recover',
                  operation: 'correction',
                  packetId: packet.id,
                })
              }
              type="button"
            >
              Reload to verify
            </button>
          ) : retryAttempt ? (
            <button
              onClick={() =>
                void workflow.act({
                  kind: 'recover',
                  operation: 'correction',
                  packetId: packet.id,
                })
              }
              type="button"
            >
              {retryAttempt.coveredOn === null ? 'Try undo again' : 'Try date change again'}
            </button>
          ) : undefined
        }
        detail={correctionFeedback.detail}
        headline={correctionFeedback.headline}
        tone={correctionFeedback.tone}
      />
    );
  }

  return (
    <>
      <OpenReconciliationOverlay
        active={active}
        lifecycle={lifecycle}
        presentation={projection?.map ?? { focusKey: null, packets: [] }}
      />
      <aside className="territory-sidebar reconciliation-sidebar tool-sidebar" hidden={!active}>
        <ToolViewSwitcher
          label="Packet workflow"
          onChange={(view) => onViewChange(view as 'generate' | 'reconcile')}
          options={packetToolViews}
          value="reconcile"
        />
        <div className="sidebar-scroll" inert={operation?.kind === 'confirm'}>
          {loading && (
            <OperationStatus
              detail="Streetlight is loading finalized packet sheets and their saved history."
              headline="Loading packet batches"
              tone="busy"
            />
          )}
          {!loading && !workspace && (
            <OperationStatus
              action={
                <button
                  className="secondary"
                  onClick={() => void workflow.act({ kind: 'recover', operation: 'load' })}
                  type="button"
                >
                  Try again
                </button>
              }
              detail={
                snapshot.kind === 'unavailable'
                  ? `${snapshot.message}. Try loading the saved records again.`
                  : 'No saved packet data was changed.'
              }
              headline="Packet batches could not be loaded"
              tone="error"
            />
          )}
          {workspace && workspace.batches.length === 0 && (
            <p className="empty-state">No finalized packet batches yet.</p>
          )}
          {workspace && workspace.batches.length > 0 && (
            <>
              {reconciliationView === 'history' && (
                <>
                  <button
                    className="reconciliation-back-link"
                    onClick={() => void workflow.act({ kind: 'view', view: 'active' })}
                    type="button"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                    </svg>
                    Back to reconciliation
                  </button>
                  <h2 className="reconciliation-history-title">History</h2>
                </>
              )}
              {visibleBatches.length > 0 && (
                <section className="coverage-field reconciliation-batch-picker">
                  {reconciliationView === 'active' && (
                    <div className="reconciliation-batch-label-row">
                      <label
                        className="reconciliation-active-picker-heading"
                        htmlFor="reconciliation-batch"
                      >
                        Active sheets
                      </label>
                      {historyBatches.length > 0 && (
                        <button
                          className="reconciliation-history-link"
                          onClick={() => void workflow.act({ kind: 'view', view: 'history' })}
                          type="button"
                        >
                          View history
                        </button>
                      )}
                    </div>
                  )}
                  <StreetlightSelect
                    ariaLabel={
                      reconciliationView === 'history' ? 'Historical batch' : 'Active batch'
                    }
                    id="reconciliation-batch"
                    onValueChange={(value) => void workflow.act({ kind: 'batch', batchId: value })}
                    options={visibleBatches.map((candidate) => ({
                      label:
                        reconciliationView === 'active'
                          ? batchOptionLabel(candidate)
                          : historyBatchOptionLabel(candidate),
                      value: candidate.id,
                    }))}
                    value={batchId ?? ''}
                  />
                </section>
              )}
              {reconciliationView === 'active' && activeBatches.length === 0 && (
                <section className="reconciliation-all-caught-up">
                  <strong>All caught up</strong>
                  <p>No packet sheets need reconciliation.</p>
                  {historyBatches.length > 0 && (
                    <button
                      className="secondary"
                      onClick={() => void workflow.act({ kind: 'view', view: 'history' })}
                      type="button"
                    >
                      View history
                    </button>
                  )}
                </section>
              )}
              {reconciliationView === 'history' && historyBatches.length === 0 && (
                <p className="empty-state">No packet history yet.</p>
              )}
              {reconciliationView === 'active' && batch && activePackets.length > 0 && (
                <section className="reconciliation-active-section">
                  <div className="reconciliation-list">
                    {activePackets.map((packet) => {
                      const outcome = packetOutcomes.get(packet.id) ?? null;
                      return (
                        <article
                          className={`reconciliation-card${selectedPacketId === packet.id ? ' selected' : ''}`}
                          key={packet.id}
                        >
                          <div className="reconciliation-card-heading">
                            <button
                              className="reconciliation-focus"
                              onClick={() =>
                                void workflow.act({ kind: 'select-packet', packetId: packet.id })
                              }
                              type="button"
                            >
                              <strong>{packet.start.address}</strong>
                              <span>
                                {packet.estimatedTracts} estimated tract
                                {packet.estimatedTracts === 1 ? '' : 's'} ·{' '}
                                {packet.kind === 'apartment' ? 'Apartment' : 'Street'}
                              </span>
                              <span className="reconciliation-packet-code">{packet.code}</span>
                            </button>
                            {!outcome && (
                              <span className="reconciliation-needs-review">Needs review</span>
                            )}
                          </div>
                          <fieldset
                            aria-label={`Outcome for ${packet.start.address}`}
                            className="reconciliation-outcomes"
                          >
                            {(
                              [
                                ['still-here', 'Still here'],
                                ['taken', 'Taken'],
                                ['discarded', 'Discarded'],
                              ] as const
                            ).map(([value, label]) => (
                              <button
                                aria-pressed={outcome === value}
                                className={`reconciliation-outcome ${value}`}
                                disabled={mutationControlsDisabled}
                                key={value}
                                onClick={() =>
                                  void workflow.act({
                                    kind: 'outcome',
                                    packetId: packet.id,
                                    outcome: value,
                                  })
                                }
                                type="button"
                              >
                                {label}
                              </button>
                            ))}
                          </fieldset>
                          <span className={`reconciliation-disposition ${outcome ?? 'unreviewed'}`}>
                            {outcome === 'still-here'
                              ? 'Keeps packet active'
                              : outcome === 'taken'
                                ? 'Will be marked completed'
                                : outcome === 'discarded'
                                  ? 'Cancels this packet and returns its streets for future generation.'
                                  : 'Choose one outcome'}
                          </span>
                          {correctionStatus(packet)}
                        </article>
                      );
                    })}
                  </div>
                  <div className="reconciliation-bulk-actions">
                    <button
                      className="secondary"
                      disabled={mutationControlsDisabled}
                      onClick={() =>
                        void workflow.act({ kind: 'all-outcomes', outcome: 'still-here' })
                      }
                      type="button"
                    >
                      All still here
                    </button>
                    <button
                      className="secondary"
                      disabled={mutationControlsDisabled}
                      onClick={() => void workflow.act({ kind: 'all-outcomes', outcome: 'taken' })}
                      type="button"
                    >
                      All taken
                    </button>
                    <button
                      className="danger"
                      disabled={mutationControlsDisabled}
                      onClick={() =>
                        void workflow.act({ kind: 'all-outcomes', outcome: 'discarded' })
                      }
                      type="button"
                    >
                      All discarded
                    </button>
                  </div>
                </section>
              )}
              {reconciliationView === 'history' && batch && historyPackets.length > 0 && (
                <section className="reconciliation-history-section">
                  <div className="reconciliation-list" id="reconciliation-history-list">
                    {historyPackets.map((packet) => {
                      const editing = editingPacketId === packet.id;
                      return (
                        <article
                          className={`reconciliation-card history${selectedPacketId === packet.id ? ' selected' : ''}`}
                          key={packet.id}
                          ref={selectedPacketId === packet.id ? selectedPacketRef : undefined}
                        >
                          <div className="reconciliation-history-summary">
                            <button
                              className="reconciliation-focus"
                              onClick={() =>
                                void workflow.act({ kind: 'select-packet', packetId: packet.id })
                              }
                              type="button"
                            >
                              <strong>{packet.start.address}</strong>
                              <span>
                                {packet.status === 'completed'
                                  ? `Completed ${packet.completedOn ? formatDate(packet.completedOn) : ''}`
                                  : 'Cancelled'}
                              </span>
                              <span className="reconciliation-packet-code">{packet.code}</span>
                            </button>
                            {packet.status === 'completed' && (
                              <button
                                aria-expanded={editing}
                                className="secondary reconciliation-history-edit"
                                onClick={() =>
                                  void workflow.act({ kind: 'edit-packet', packetId: packet.id })
                                }
                                type="button"
                              >
                                {editing ? 'Close' : 'Edit date'}
                              </button>
                            )}
                          </div>
                          {packet.status === 'completed' && editing && (
                            <form
                              className="reconciliation-correction"
                              key={`${packet.id}:${packet.completedOn}`}
                              onSubmit={(event) => {
                                event.preventDefault();
                                const coveredOn = new FormData(event.currentTarget).get(
                                  'coveredOn',
                                );
                                if (typeof coveredOn === 'string' && coveredOn) {
                                  void correct({ packetId: packet.id, coveredOn });
                                }
                              }}
                            >
                              <label>
                                Outreach date
                                <input
                                  defaultValue={packet.completedOn ?? workspace.asOf}
                                  disabled={mutationControlsDisabled}
                                  max={workspace.asOf}
                                  name="coveredOn"
                                  required
                                  type="date"
                                />
                              </label>
                              <div>
                                <button disabled={mutationControlsDisabled} type="submit">
                                  Change date
                                </button>
                                <button
                                  className="danger"
                                  disabled={mutationControlsDisabled}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        'Undo this whole packet completion and restore its reservation?',
                                      )
                                    ) {
                                      void correct({ packetId: packet.id, coveredOn: null });
                                    }
                                  }}
                                  type="button"
                                >
                                  Undo completion
                                </button>
                              </div>
                            </form>
                          )}
                          {correctionStatus(packet)}
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {reconciliationView === 'active' && reviewing && batch && (
                <section className="reconciliation-review">
                  <h2>Review reconciliation</h2>
                  <strong className="reconciliation-review-summary">
                    {preview.complete.length} packet
                    {preview.complete.length === 1 ? '' : 's'} will be recorded as completed
                  </strong>
                  <p>Coverage date: {formatDate(workspace.asOf)}</p>
                  {(
                    [
                      ['Mark completed', preview.complete],
                      ['Keep active', preview.active],
                      ['Discard and release', preview.cancel],
                    ] as const
                  ).map(([label, ids]) => (
                    <div key={label}>
                      <strong>{label}</strong>
                      {ids.length === 0 ? (
                        <span>None</span>
                      ) : (
                        ids.map((id) => <span key={id}>{packetById.get(id)?.start.address}</span>)
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
        <div className="sidebar-actions">
          {reconciliationView === 'active' && batch && activePackets.length > 0 && (
            <p aria-live="polite" className="reconciliation-outcome-summary">
              {preview.unreviewed.length > 0 && (
                <>
                  <strong>
                    {preview.unreviewed.length} {preview.unreviewed.length === 1 ? 'needs' : 'need'}{' '}
                    review
                  </strong>{' '}
                  ·{' '}
                </>
              )}
              {preview.active.length} still here · {preview.complete.length} will be completed
              {preview.cancel.length > 0 ? ` · ${preview.cancel.length} will be cancelled` : ''}
            </p>
          )}
          {operation?.kind === 'confirm' ? (
            <OperationStatus
              detail="Your packet choices are locked while Streetlight records the whole batch."
              headline="Saving reconciliation"
              tone="busy"
            />
          ) : (
            feedback?.operation === 'confirm' && (
              <OperationStatus
                action={
                  feedback.recovery === 'reload' ? (
                    <button
                      onClick={() => void workflow.act({ kind: 'recover', operation: 'confirm' })}
                      type="button"
                    >
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
          {reconciliationView === 'active' && batch && activePackets.length > 0 && (
            <div className={reviewing ? 'reviewing' : ''}>
              {reviewing ? (
                <>
                  <button
                    className="secondary"
                    disabled={mutationControlsDisabled}
                    onClick={() => void workflow.act({ kind: 'review', reviewing: false })}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    disabled={mutationControlsDisabled}
                    onClick={() => void confirm()}
                    type="button"
                  >
                    {busy
                      ? 'Saving…'
                      : feedback?.operation === 'confirm' && feedback.tone === 'error'
                        ? 'Try reconciliation again'
                        : 'Confirm reconciliation'}
                  </button>
                </>
              ) : (
                <button
                  disabled={!reviewReady || mutationControlsDisabled}
                  onClick={() => void workflow.act({ kind: 'review', reviewing: true })}
                  type="button"
                >
                  Review reconciliation
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
