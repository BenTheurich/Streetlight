'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReconciliationChoices,
  type ReconciliationBatch,
  type ReconciliationOutcome,
  type ReconciliationPacket,
  type ReconciliationWorkspace,
} from '@/lib/reconciliation';
import { OpenReconciliationOverlay } from './OpenReconciliationOverlay';
import { OperationStatus } from './OperationStatus';
import { isReconciliationWorkspacePayload, readMutationResult } from './operation-state';
import { packetToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function batchOptionLabel(batch: ReconciliationBatch): string {
  const automaticPrefix = 'Outreach batch - ';
  const automaticTimestamp = batch.name.startsWith(automaticPrefix)
    ? batch.name.slice(automaticPrefix.length)
    : null;
  const name = automaticTimestamp ? 'Outreach batch' : batch.name;
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
  map,
  onChanged,
  onViewChange,
}: {
  active: boolean;
  map: MapLibreMap | null;
  onChanged: () => Promise<void>;
  onViewChange: (view: 'generate' | 'reconcile') => void;
}) {
  const [workspace, setWorkspace] = useState<ReconciliationWorkspace | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [packetOutcomes, setPacketOutcomes] = useState<Map<string, ReconciliationOutcome>>(
    new Map(),
  );
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [editingPacketId, setEditingPacketId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<ReconciliationOperation | null>(null);
  const [feedback, setFeedback] = useState<ReconciliationFeedback | null>(null);
  const requestedRef = useRef(false);
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
      setBatchId((current) =>
        result.batches.some(({ id }) => id === current) ? current : result.defaultBatchId,
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

  const batch = workspace?.batches.find(({ id }) => id === batchId) ?? null;
  const activePackets = useMemo(
    () => batch?.packets.filter(({ status }) => status === 'active') ?? [],
    [batch],
  );
  const historyPackets = useMemo(
    () => batch?.packets.filter(({ status }) => status !== 'active') ?? [],
    [batch],
  );
  const activePacketIds = useMemo(() => activePackets.map(({ id }) => id), [activePackets]);
  const preview = useMemo(
    () => buildReconciliationChoices(activePacketIds, packetOutcomes),
    [activePacketIds, packetOutcomes],
  );
  const overlayPresentIds = useMemo(
    () => new Set([...preview.active, ...preview.cancel, ...preview.unreviewed]),
    [preview],
  );
  const overlayCancelIds = useMemo(() => new Set(preview.cancel), [preview.cancel]);
  const reviewReady = preview.unreviewed.length === 0;
  const packetById = new Map(batch?.packets.map((packet) => [packet.id, packet]) ?? []);

  function resetChoices(): void {
    setPacketOutcomes(new Map());
    setSelectedPacketId(null);
    setEditingPacketId(null);
    setReviewing(false);
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
    setBatchId((current) =>
      next.batches.some(({ id }) => id === current) ? current : next.defaultBatchId,
    );
    resetChoices();
  }

  async function confirm(): Promise<void> {
    if (!batch || !reviewReady) return;
    setOperation({ kind: 'confirm' });
    setFeedback(null);
    const outcome = await readMutationResult(
      () =>
        fetch('/api/reconciliation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            batchId: batch.id,
            activePacketIds,
            presentPacketIds: [...preview.active, ...preview.cancel],
            cancelPacketIds: preview.cancel,
          }),
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
      preview.complete.length === 0
        ? 'No missing sheets were recorded as completed.'
        : `${preview.complete.length} missing packet sheet${preview.complete.length === 1 ? '' : 's'} recorded as completed on ${formatDate(workspace?.asOf ?? result.asOf)}.`;
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
        batch={batch}
        cancelIds={overlayCancelIds}
        map={map}
        presentIds={overlayPresentIds}
        selectedPacketId={selectedPacketId}
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
              <section className="reconciliation-batch-picker">
                <label className="coverage-field">
                  Batch
                  <select
                    onChange={(event) => {
                      setBatchId(event.target.value);
                      resetChoices();
                      setHistoryOpen(false);
                    }}
                    value={batchId ?? ''}
                  >
                    {workspace.batches.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {batchOptionLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              {batch && activePackets.length > 0 && (
                <section className="reconciliation-active-section">
                  <h2>What happened to each sheet?</h2>
                  <p className="reconciliation-instructions">
                    Choose one outcome for every packet sheet.
                  </p>
                  <div className="packet-results-header">
                    <strong>Active sheets</strong>
                  </div>
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
              {batch && historyPackets.length > 0 && (
                <section className="reconciliation-history-section">
                  {activePackets.length > 0 ? (
                    <h2 className="reconciliation-history-heading">
                      <button
                        aria-controls="reconciliation-history-list"
                        aria-expanded={historyOpen}
                        className="reconciliation-history-toggle"
                        onClick={() => setHistoryOpen((current) => !current)}
                        type="button"
                      >
                        <span>Batch history</span>
                        <span className="reconciliation-history-count">
                          {historyPackets.length}
                        </span>
                        <svg aria-hidden="true" viewBox="0 0 12 8">
                          <path d="m1 1 5 5 5-5" />
                        </svg>
                      </button>
                    </h2>
                  ) : (
                    <div className="packet-results-header">
                      <strong>Batch history</strong>
                    </div>
                  )}
                  {(activePackets.length === 0 || historyOpen) && (
                    <div className="reconciliation-list" id="reconciliation-history-list">
                      {historyPackets.map((packet) => {
                        const editing = editingPacketId === packet.id;
                        return (
                          <article
                            className={`reconciliation-card history${selectedPacketId === packet.id ? ' selected' : ''}`}
                            key={packet.id}
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
                  )}
                </section>
              )}
              {reviewing && batch && (
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
          {batch && activePackets.length > 0 && (
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
          {batch && activePackets.length > 0 && (
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
