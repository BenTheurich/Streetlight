'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapOverlayLifecycle } from '@/lib/map-overlay-lifecycle';
import {
  projectReconciliation,
  type ReconciliationBatch,
  type ReconciliationHistoryTarget,
  type ReconciliationOutcome,
  type ReconciliationPacket,
  type ReconciliationView,
  type ReconciliationWorkspace,
} from '@/lib/reconciliation';
import { OpenReconciliationOverlay } from './OpenReconciliationOverlay';
import { OperationStatus } from './OperationStatus';
import { isReconciliationWorkspacePayload, readMutationResult } from './operation-state';
import { StreetlightSelect } from './StreetlightSelect';
import { packetToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function batchOptionLabel(batch: ReconciliationBatch): string {
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

function historyBatchOptionLabel(batch: ReconciliationBatch): string {
  return batchOptionLabel(batch).replace(
    /\d+ active$/,
    `${batch.counts.completed + batch.counts.cancelled} records`,
  );
}

type CorrectionAttempt = {
  packetId: string;
  coveredOn: string | null;
};

type ReconciliationOperation =
  | { kind: 'confirm' }
  | { kind: 'correction'; attempt: CorrectionAttempt };

type ReconciliationFeedbackBase = {
  detail: string;
  headline: string;
  recovery?: 'retry' | 'reload';
  tone: 'error' | 'success';
};

type ReconciliationFeedback =
  | (ReconciliationFeedbackBase & { operation: 'load' | 'confirm' })
  | (ReconciliationFeedbackBase & {
      operation: 'correction';
      attempt: CorrectionAttempt;
    });

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
  const [workspace, setWorkspace] = useState<ReconciliationWorkspace | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [packetOutcomes, setPacketOutcomes] = useState<Map<string, ReconciliationOutcome>>(
    new Map(),
  );
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [editingPacketId, setEditingPacketId] = useState<string | null>(null);
  const [reconciliationView, setReconciliationView] = useState<ReconciliationView>('active');
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<ReconciliationOperation | null>(null);
  const [feedback, setFeedback] = useState<ReconciliationFeedback | null>(null);
  const requestedRef = useRef(false);
  const selectedPacketRef = useRef<HTMLElement | null>(null);
  const busy = operation !== null;
  const verificationRequired = feedback?.recovery === 'reload';
  const mutationControlsDisabled = busy || verificationRequired;

  const load = useCallback(async () => {
    requestedRef.current = true;
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/reconciliation');
      const result = (await response.json()) as ReconciliationWorkspace | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not load packet reconciliation');
      }
      setWorkspace(result);
      setBatchId(
        (current) =>
          projectReconciliation(result, {
            batchId: current ?? result.defaultBatchId,
            outcomes: new Map(),
            selectedPacketId: null,
            view: 'active',
          }).batch?.id ?? null,
      );
    } catch (error) {
      requestedRef.current = false;
      setFeedback({
        detail: `${error instanceof Error ? error.message : 'Could not load packet reconciliation'}. No packet records were changed.`,
        headline: 'Packet batches could not be loaded',
        operation: 'load',
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !requestedRef.current) void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || !workspace || !target) return;
    const selection = projectReconciliation(workspace, {
      batchId: null,
      historyTarget: target,
      outcomes: new Map(),
      selectedPacketId: null,
      view: 'history',
    }).targetSelection;
    if (selection) {
      setReconciliationView('history');
      setBatchId(selection.batchId);
      setPacketOutcomes(new Map());
      setSelectedPacketId(selection.packetId);
      setEditingPacketId(null);
      setReviewing(false);
    }
    onTargetHandled();
  }, [active, onTargetHandled, target, workspace]);

  useEffect(() => {
    if (!active || reconciliationView !== 'history' || !selectedPacketId) return;
    const frame = requestAnimationFrame(() =>
      selectedPacketRef.current?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, reconciliationView, selectedPacketId]);
  const projection = useMemo(
    () =>
      workspace
        ? projectReconciliation(workspace, {
            batchId,
            outcomes: packetOutcomes,
            selectedPacketId,
            view: reconciliationView,
          })
        : null,
    [batchId, packetOutcomes, reconciliationView, selectedPacketId, workspace],
  );
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

  function resetChoices(): void {
    setPacketOutcomes(new Map());
    setSelectedPacketId(null);
    setEditingPacketId(null);
    setReviewing(false);
  }

  function showReconciliationView(view: ReconciliationView): void {
    setReconciliationView(view);
    setBatchId(
      workspace
        ? (projectReconciliation(workspace, {
            batchId,
            outcomes: new Map(),
            selectedPacketId: null,
            view,
          }).batch?.id ?? null)
        : null,
    );
    resetChoices();
  }

  function setPacketOutcome(packetId: string, outcome: ReconciliationOutcome): void {
    setPacketOutcomes((current) => {
      const next = new Map(current);
      next.set(packetId, outcome);
      return next;
    });
    setReviewing(false);
  }

  function replaceWorkspace(next: ReconciliationWorkspace): void {
    setWorkspace(next);
    setBatchId(
      (current) =>
        projectReconciliation(next, {
          batchId: current,
          outcomes: new Map(),
          selectedPacketId: null,
          view: reconciliationView,
        }).batch?.id ?? null,
    );
    resetChoices();
  }

  async function confirm(): Promise<void> {
    if (!projection?.submission) return;
    const submission = projection.submission;
    const submittedReview = projection.review;
    setOperation({ kind: 'confirm' });
    setFeedback(null);
    const outcome = await readMutationResult(
      () =>
        fetch('/api/reconciliation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(submission),
        }),
      isReconciliationWorkspacePayload,
    );
    if (outcome.status !== 'success') {
      setFeedback(
        outcome.status === 'rejected'
          ? {
              detail: `${outcome.message}. Your packet choices are still selected.`,
              headline: 'Reconciliation was not saved',
              operation: 'confirm',
              recovery: outcome.recovery,
              tone: 'error',
            }
          : {
              detail:
                'Streetlight could not confirm whether the reconciliation was saved. Your packet choices are still selected. Reload to verify before trying again.',
              headline: 'Could not confirm reconciliation',
              operation: 'confirm',
              recovery: outcome.recovery,
              tone: 'error',
            },
      );
      setOperation(null);
      return;
    }

    const result = outcome.value;
    replaceWorkspace(result);
    const detail =
      submittedReview.complete.length === 0
        ? 'No missing sheets were recorded as completed.'
        : `${submittedReview.complete.length} missing packet sheet${submittedReview.complete.length === 1 ? '' : 's'} recorded as completed on ${formatDate(workspace?.asOf ?? result.asOf)}.`;
    try {
      await onChanged();
      setFeedback({
        detail,
        headline: 'Reconciliation saved',
        operation: 'confirm',
        tone: 'success',
      });
    } catch {
      setFeedback({
        detail: `${detail} Reload the page to refresh the coverage map.`,
        headline: 'Reconciliation saved',
        operation: 'confirm',
        tone: 'success',
      });
    }
    setOperation(null);
  }

  async function correct(packet: ReconciliationPacket, coveredOn: string | null): Promise<void> {
    const attempt: CorrectionAttempt = { packetId: packet.id, coveredOn };
    setOperation({ kind: 'correction', attempt: { packetId: packet.id, coveredOn } });
    setFeedback(null);
    const outcome = await readMutationResult(
      () =>
        fetch('/api/reconciliation', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ packetId: packet.id, coveredOn }),
        }),
      isReconciliationWorkspacePayload,
    );
    if (outcome.status !== 'success') {
      setFeedback(
        outcome.status === 'rejected'
          ? {
              detail: `${outcome.message}. Saved reconciliation history is unchanged.`,
              headline: 'Packet history was not changed',
              attempt,
              operation: 'correction',
              recovery: outcome.recovery,
              tone: 'error',
            }
          : {
              detail:
                'Streetlight could not confirm whether packet history changed. Reload to verify the saved history before trying again.',
              headline: 'Could not confirm packet history',
              attempt,
              operation: 'correction',
              recovery: outcome.recovery,
              tone: 'error',
            },
      );
      setOperation(null);
      return;
    }

    replaceWorkspace(outcome.value);
    const detail = coveredOn === null ? 'Packet completion was undone.' : 'Packet date changed.';
    try {
      await onChanged();
      setFeedback({
        detail,
        headline: 'Packet history updated',
        attempt,
        operation: 'correction',
        tone: 'success',
      });
    } catch {
      setFeedback({
        detail: `${detail} Reload the page to refresh the coverage map.`,
        headline: 'Packet history updated',
        attempt,
        operation: 'correction',
        tone: 'success',
      });
    }
    setOperation(null);
  }

  function correctionStatus(packet: ReconciliationPacket) {
    const correcting = operation?.kind === 'correction' && operation.attempt.packetId === packet.id;
    const correctionFeedback =
      feedback && 'attempt' in feedback && feedback.attempt.packetId === packet.id
        ? feedback
        : null;

    if (correcting) {
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
          correctionFeedback.recovery === 'reload' ? (
            <button onClick={() => window.location.reload()} type="button">
              Reload to verify
            </button>
          ) : correctionFeedback.tone === 'error' ? (
            <button
              onClick={() => void correct(packet, correctionFeedback.attempt.coveredOn)}
              type="button"
            >
              {correctionFeedback.attempt.coveredOn === null
                ? 'Try undo again'
                : 'Try date change again'}
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
                <button className="secondary" onClick={() => void load()} type="button">
                  Try again
                </button>
              }
              detail={feedback?.detail ?? 'No saved packet data was changed.'}
              headline={feedback?.headline ?? 'Packet batches are unavailable'}
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
                    onClick={() => showReconciliationView('active')}
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
                          onClick={() => showReconciliationView('history')}
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
                    onValueChange={(value) => {
                      setBatchId(value);
                      resetChoices();
                    }}
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
                      onClick={() => showReconciliationView('history')}
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
                                setSelectedPacketId((current) =>
                                  current === packet.id ? null : packet.id,
                                )
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
                                onClick={() => setPacketOutcome(packet.id, value)}
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
                      onClick={() => {
                        setPacketOutcomes(
                          new Map(activePackets.map(({ id }) => [id, 'still-here'] as const)),
                        );
                        setReviewing(false);
                      }}
                      type="button"
                    >
                      All still here
                    </button>
                    <button
                      className="secondary"
                      disabled={mutationControlsDisabled}
                      onClick={() => {
                        setPacketOutcomes(
                          new Map(activePackets.map(({ id }) => [id, 'taken'] as const)),
                        );
                        setReviewing(false);
                      }}
                      type="button"
                    >
                      All taken
                    </button>
                    <button
                      className="danger"
                      disabled={mutationControlsDisabled}
                      onClick={() => {
                        setPacketOutcomes(
                          new Map(activePackets.map(({ id }) => [id, 'discarded'] as const)),
                        );
                        setReviewing(false);
                      }}
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
                                setSelectedPacketId((current) =>
                                  current === packet.id ? null : packet.id,
                                )
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
                                  setEditingPacketId((current) =>
                                    current === packet.id ? null : packet.id,
                                  )
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
                                  void correct(packet, coveredOn);
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
                                      void correct(packet, null);
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
          {reconciliationView === 'active' && batch && activePackets.length > 0 && (
            <div className={reviewing ? 'reviewing' : ''}>
              {reviewing ? (
                <>
                  <button
                    className="secondary"
                    disabled={mutationControlsDisabled}
                    onClick={() => setReviewing(false)}
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
                  onClick={() => setReviewing(true)}
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
