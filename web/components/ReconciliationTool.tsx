'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReconciliationPreview,
  type ReconciliationPacket,
  type ReconciliationWorkspace,
} from '@/lib/reconciliation';
import { OpenReconciliationOverlay } from './OpenReconciliationOverlay';
import { OperationStatus } from './OperationStatus';
import { isReconciliationWorkspacePayload, readMutationResult } from './operation-state';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
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
  map,
  onChanged,
}: {
  active: boolean;
  map: MapLibreMap | null;
  onChanged: () => Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<ReconciliationWorkspace | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [cancelIds, setCancelIds] = useState<Set<string>>(new Set());
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
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
  const preview = buildReconciliationPreview(
    activePackets.map(({ id }) => id),
    [...presentIds],
    [...cancelIds],
  );
  const packetById = new Map(batch?.packets.map((packet) => [packet.id, packet]) ?? []);

  function resetChoices(): void {
    setPresentIds(new Set());
    setCancelIds(new Set());
    setSelectedPacketId(null);
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
    if (!batch) return;
    setOperation({ kind: 'confirm' });
    setFeedback(null);
    const outcome = await readMutationResult(
      () =>
        fetch('/api/reconciliation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            batchId: batch.id,
            activePacketIds: activePackets.map(({ id }) => id),
            presentPacketIds: [...presentIds],
            cancelPacketIds: [...cancelIds],
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
        cancelIds={cancelIds}
        map={map}
        presentIds={presentIds}
        selectedPacketId={selectedPacketId}
      />
      <aside className="territory-sidebar reconciliation-sidebar" hidden={!active}>
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
              <section>
                <label className="coverage-field">
                  Batch
                  <select
                    onChange={(event) => {
                      setBatchId(event.target.value);
                      resetChoices();
                    }}
                    value={batchId ?? ''}
                  >
                    {workspace.batches.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} · {candidate.counts.active} active
                      </option>
                    ))}
                  </select>
                </label>
                {batch && (
                  <p className="reconciliation-batch-summary">
                    {batch.finalizedAt
                      ? `Finalized ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(batch.finalizedAt))}`
                      : 'Not finalized'}{' '}
                    · {batch.counts.completed} completed · {batch.counts.cancelled} cancelled
                  </p>
                )}
              </section>
              {batch && activePackets.length > 0 && (
                <section>
                  <h2>Which packet sheets are still here?</h2>
                  <p className="reconciliation-instructions">
                    Check every sheet that is still physically on the table. Unchecked sheets will
                    be recorded as completed.
                  </p>
                  <div className="packet-results-header">
                    <strong>Active sheets</strong>
                    <div className="reconciliation-bulk-actions">
                      <button
                        className="secondary"
                        onClick={() => {
                          setPresentIds(new Set(activePackets.map(({ id }) => id)));
                          setCancelIds(new Set());
                          setReviewing(false);
                        }}
                        type="button"
                      >
                        Select all present
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          setPresentIds(new Set());
                          setCancelIds(new Set());
                          setReviewing(false);
                        }}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="reconciliation-list">
                    {activePackets.map((packet) => {
                      const present = presentIds.has(packet.id);
                      const cancelling = cancelIds.has(packet.id);
                      return (
                        <article
                          className={`reconciliation-card${selectedPacketId === packet.id ? ' selected' : ''}`}
                          key={packet.id}
                        >
                          <label className="reconciliation-present">
                            <input
                              checked={present}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setPresentIds((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(packet.id);
                                  else next.delete(packet.id);
                                  return next;
                                });
                                if (!checked) {
                                  setCancelIds((current) => {
                                    const next = new Set(current);
                                    next.delete(packet.id);
                                    return next;
                                  });
                                }
                                setReviewing(false);
                              }}
                              type="checkbox"
                            />
                            Still on table
                          </label>
                          <button
                            className="reconciliation-focus"
                            onClick={() =>
                              setSelectedPacketId((current) =>
                                current === packet.id ? null : packet.id,
                              )
                            }
                            type="button"
                          >
                            <strong>{packet.code}</strong>
                            <span>
                              {packet.estimatedTracts} estimated tracts ·{' '}
                              {packet.kind === 'apartment' ? 'Apartment' : 'Street'}
                            </span>
                            <span>{packet.start.address}</span>
                          </button>
                          {!present ? (
                            <span className="reconciliation-disposition complete">
                              Missing — complete
                            </span>
                          ) : (
                            <label className="reconciliation-action">
                              Sheet action
                              <select
                                onChange={(event) => {
                                  setCancelIds((current) => {
                                    const next = new Set(current);
                                    if (event.target.value === 'cancel') next.add(packet.id);
                                    else next.delete(packet.id);
                                    return next;
                                  });
                                  setReviewing(false);
                                }}
                                value={cancelling ? 'cancel' : 'active'}
                              >
                                <option value="active">Keep active</option>
                                <option value="cancel">Cancel and release</option>
                              </select>
                            </label>
                          )}
                          {correctionStatus(packet)}
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {batch && activePackets.length === 0 && (
                <p className="empty-state">This batch has no active sheets.</p>
              )}
              {batch && historyPackets.length > 0 && (
                <section>
                  <h2>Batch history</h2>
                  <div className="reconciliation-list">
                    {historyPackets.map((packet) => {
                      return (
                        <article
                          className={`reconciliation-card history${selectedPacketId === packet.id ? ' selected' : ''}`}
                          key={packet.id}
                        >
                          <button
                            className="reconciliation-focus"
                            onClick={() =>
                              setSelectedPacketId((current) =>
                                current === packet.id ? null : packet.id,
                              )
                            }
                            type="button"
                          >
                            <strong>{packet.code}</strong>
                            <span>
                              {packet.status === 'completed'
                                ? `Completed ${packet.completedOn ? formatDate(packet.completedOn) : ''}`
                                : 'Cancelled'}
                            </span>
                          </button>
                          {packet.status === 'completed' && (
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
              {reviewing && batch && (
                <section className="reconciliation-review">
                  <h2>Review reconciliation</h2>
                  <p>Coverage date: {formatDate(workspace.asOf)}</p>
                  {(
                    [
                      ['Complete missing', preview.complete],
                      ['Keep active', preview.active],
                      ['Cancel', preview.cancel],
                    ] as const
                  ).map(([label, ids]) => (
                    <div key={label}>
                      <strong>{label}</strong>
                      {ids.length === 0 ? (
                        <span>None</span>
                      ) : (
                        ids.map((id) => <span key={id}>{packetById.get(id)?.code}</span>)
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
        <div className="sidebar-actions">
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
                <button onClick={() => setReviewing(true)} type="button">
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
