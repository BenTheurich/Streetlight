import {
  type CorrectionAttempt,
  isReconciliationWorkspacePayload,
  type ReconciliationCorrectionFeedback,
  readMutationResult,
  reconciliationMutationControlsDisabled,
} from './operation-state.ts';
import {
  projectReconciliation,
  type ReconciliationHistoryTarget,
  type ReconciliationOutcome,
  type ReconciliationProjection,
  type ReconciliationSubmission,
  type ReconciliationView,
  type ReconciliationWorkspace,
} from './reconciliation.ts';

export type ReconciliationOperation =
  | { kind: 'confirm' }
  | { kind: 'correction'; attempt: CorrectionAttempt };

type ReconciliationFeedbackBase = {
  detail: string;
  headline: string;
  recovery?: 'retry' | 'reload';
  tone: 'error' | 'success';
};

export type ReconciliationFeedback =
  | (ReconciliationFeedbackBase & { operation: 'confirm' })
  | ReconciliationCorrectionFeedback;

export type ReconciliationDraft = {
  batchId: string | null;
  outcomes: ReadonlyMap<string, ReconciliationOutcome>;
  selectedPacketId: string | null;
  editingPacketId: string | null;
  view: ReconciliationView;
  reviewing: boolean;
};

export type ReconciliationWorkflowSnapshot =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | {
      kind: 'ready';
      accepted: ReconciliationWorkspace;
      draft: ReconciliationDraft;
      projection: ReconciliationProjection;
      operation: ReconciliationOperation | null;
      feedback: ReconciliationFeedback | null;
      mutationControlsDisabled: boolean;
    };

export type ReconciliationAction =
  | { kind: 'load' }
  | { kind: 'target'; target: ReconciliationHistoryTarget }
  | { kind: 'view'; view: ReconciliationView }
  | { kind: 'batch'; batchId: string }
  | { kind: 'outcome'; packetId: string; outcome: ReconciliationOutcome }
  | { kind: 'all-outcomes'; outcome: ReconciliationOutcome }
  | { kind: 'select-packet'; packetId: string }
  | { kind: 'edit-packet'; packetId: string }
  | { kind: 'review'; reviewing: boolean }
  | { kind: 'confirm' }
  | { kind: 'correct'; attempt: CorrectionAttempt }
  | { kind: 'recover'; operation: 'load' | 'confirm' | 'correction'; packetId?: string };

export type ReconciliationTransport = {
  load: () => Promise<Response>;
  reconcile: (submission: ReconciliationSubmission) => Promise<Response>;
  correct: (attempt: CorrectionAttempt) => Promise<Response>;
};

export type ReconciliationWorkflow = Readonly<{
  getSnapshot: () => ReconciliationWorkflowSnapshot;
  subscribe: (listener: () => void) => () => void;
  act: (action: ReconciliationAction) => Promise<void>;
}>;

type WorkflowOptions = {
  onAccepted: () => Promise<void>;
  transport?: ReconciliationTransport;
  reload?: () => void;
};

type InternalState = {
  load: 'idle' | 'loading' | 'unavailable' | 'ready';
  loadError: string;
  accepted: ReconciliationWorkspace | null;
  draft: ReconciliationDraft;
  operation: ReconciliationOperation | null;
  feedback: ReconciliationFeedback | null;
};

type ConfirmationAttempt = {
  submission: ReconciliationSubmission;
  review: ReconciliationProjection['review'];
  asOf: string;
};

function browserTransport(): ReconciliationTransport {
  const request = (init?: RequestInit) => fetch('/api/reconciliation', init);
  return {
    load: () => request(),
    reconcile: (submission) =>
      request({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      }),
    correct: (attempt) =>
      request({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(attempt),
      }),
  };
}

function initialDraft(): ReconciliationDraft {
  return {
    batchId: null,
    outcomes: new Map(),
    selectedPacketId: null,
    editingPacketId: null,
    view: 'active',
    reviewing: false,
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function createReconciliationWorkflow(options: WorkflowOptions): ReconciliationWorkflow {
  const transport = options.transport ?? browserTransport();
  const reload = options.reload ?? (() => window.location.reload());
  const listeners = new Set<() => void>();
  const state: InternalState = {
    load: 'idle',
    loadError: '',
    accepted: null,
    draft: initialDraft(),
    operation: null,
    feedback: null,
  };
  let snapshot: ReconciliationWorkflowSnapshot = { kind: 'idle' };
  let confirmationRetry: ConfirmationAttempt | null = null;
  let correctionRetry: CorrectionAttempt | null = null;

  function buildSnapshot(): ReconciliationWorkflowSnapshot {
    if (state.load === 'idle') return { kind: 'idle' };
    if (state.load === 'loading') return { kind: 'loading' };
    if (state.load === 'unavailable' || !state.accepted) {
      return {
        kind: 'unavailable',
        message: state.loadError || 'Could not load packet reconciliation',
      };
    }
    return {
      kind: 'ready',
      accepted: state.accepted,
      draft: state.draft,
      projection: projectReconciliation(state.accepted, {
        batchId: state.draft.batchId,
        outcomes: state.draft.outcomes,
        selectedPacketId: state.draft.selectedPacketId,
        view: state.draft.view,
      }),
      operation: state.operation,
      feedback: state.feedback,
      mutationControlsDisabled: reconciliationMutationControlsDisabled(
        state.operation !== null,
        state.feedback?.recovery,
      ),
    };
  }

  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function resetDraft(workspace: ReconciliationWorkspace, view = state.draft.view): void {
    clearConfirmationFailure();
    const projection = projectReconciliation(workspace, {
      batchId: state.draft.batchId,
      outcomes: new Map(),
      selectedPacketId: null,
      view,
    });
    state.draft = {
      batchId: projection.batch?.id ?? null,
      outcomes: new Map(),
      selectedPacketId: null,
      editingPacketId: null,
      view: projection.view,
      reviewing: false,
    };
  }

  function clearConfirmationFailure(): void {
    if (state.feedback?.operation !== 'confirm' || state.feedback.tone !== 'error') return;
    state.feedback = null;
    confirmationRetry = null;
  }

  async function load(): Promise<void> {
    if (state.load === 'loading' || state.load === 'ready') return;
    state.load = 'loading';
    state.loadError = '';
    publish();
    const result = await readMutationResult(transport.load, isReconciliationWorkspacePayload);
    if (result.status !== 'success') {
      state.load = 'unavailable';
      state.loadError =
        result.status === 'rejected' ? result.message : 'Could not load packet reconciliation';
      publish();
      return;
    }
    state.load = 'ready';
    state.accepted = result.value;
    resetDraft(result.value, 'active');
    state.operation = null;
    state.feedback = null;
    confirmationRetry = null;
    correctionRetry = null;
    publish();
  }

  async function notifyAccepted(feedback: ReconciliationFeedback): Promise<void> {
    try {
      await options.onAccepted();
      state.feedback = feedback;
    } catch {
      state.feedback = {
        ...feedback,
        detail: `${feedback.detail} Reload the page to refresh the coverage map.`,
      };
    }
    publish();
  }

  async function reconcile(attempt: ConfirmationAttempt): Promise<void> {
    if (state.operation || state.feedback?.recovery === 'reload') return;
    confirmationRetry = attempt;
    state.operation = { kind: 'confirm' };
    state.feedback = null;
    publish();
    const result = await readMutationResult(
      () => transport.reconcile(attempt.submission),
      isReconciliationWorkspacePayload,
    );
    if (result.status !== 'success') {
      state.operation = null;
      state.feedback =
        result.status === 'rejected'
          ? {
              detail: `${result.message}. Your packet choices are still selected.`,
              headline: 'Reconciliation was not saved',
              operation: 'confirm',
              recovery: result.recovery,
              tone: 'error',
            }
          : {
              detail:
                'Streetlight could not confirm whether the reconciliation was saved. Your packet choices are still selected. Reload to verify before trying again.',
              headline: 'Could not confirm reconciliation',
              operation: 'confirm',
              recovery: result.recovery,
              tone: 'error',
            };
      publish();
      return;
    }

    state.accepted = result.value;
    resetDraft(result.value);
    state.operation = null;
    confirmationRetry = null;
    correctionRetry = null;
    publish();
    const completed = attempt.review.complete.length;
    await notifyAccepted({
      detail:
        completed === 0
          ? 'No missing sheets were recorded as completed.'
          : `${completed} missing packet sheet${completed === 1 ? '' : 's'} recorded as completed on ${formatDate(attempt.asOf)}.`,
      headline: 'Reconciliation saved',
      operation: 'confirm',
      tone: 'success',
    });
  }

  async function correct(attempt: CorrectionAttempt): Promise<void> {
    if (state.operation || state.feedback?.recovery === 'reload') return;
    correctionRetry = attempt;
    state.operation = { kind: 'correction', attempt };
    state.feedback = null;
    publish();
    const result = await readMutationResult(
      () => transport.correct(attempt),
      isReconciliationWorkspacePayload,
    );
    if (result.status !== 'success') {
      state.operation = null;
      state.feedback =
        result.status === 'rejected'
          ? {
              detail: `${result.message}. Saved reconciliation history is unchanged.`,
              headline: 'Packet history was not changed',
              attempt,
              operation: 'correction',
              recovery: result.recovery,
              tone: 'error',
            }
          : {
              detail:
                'Streetlight could not confirm whether packet history changed. Reload to verify the saved history before trying again.',
              headline: 'Could not confirm packet history',
              attempt,
              operation: 'correction',
              recovery: result.recovery,
              tone: 'error',
            };
      publish();
      return;
    }

    state.accepted = result.value;
    resetDraft(result.value);
    state.operation = null;
    confirmationRetry = null;
    correctionRetry = null;
    publish();
    await notifyAccepted({
      detail: attempt.coveredOn === null ? 'Packet completion was undone.' : 'Packet date changed.',
      headline: 'Packet history updated',
      attempt,
      operation: 'correction',
      tone: 'success',
    });
  }

  async function recover(operation: 'load' | 'confirm' | 'correction', packetId?: string) {
    if (operation === 'load') {
      await load();
      return;
    }
    if (operation === 'confirm' && state.feedback?.operation === 'confirm') {
      if (state.feedback.recovery === 'reload') reload();
      else if (confirmationRetry) await reconcile(confirmationRetry);
      return;
    }
    if (
      operation === 'correction' &&
      state.feedback?.operation === 'correction' &&
      state.feedback.attempt.packetId === packetId
    ) {
      if (state.feedback.recovery === 'reload') reload();
      else if (correctionRetry) await correct(correctionRetry);
    }
  }

  async function act(action: ReconciliationAction): Promise<void> {
    if (action.kind === 'load') return load();
    if (action.kind === 'recover') return recover(action.operation, action.packetId);
    if (snapshot.kind !== 'ready') return;

    if (action.kind === 'confirm') {
      const attempt = snapshot.projection.submission
        ? {
            submission: snapshot.projection.submission,
            review: snapshot.projection.review,
            asOf: snapshot.accepted.asOf,
          }
        : null;
      if (attempt) await reconcile(attempt);
      return;
    }
    if (action.kind === 'correct') return correct(action.attempt);
    if (snapshot.mutationControlsDisabled) return;

    if (action.kind === 'target') {
      const target = projectReconciliation(snapshot.accepted, {
        batchId: null,
        historyTarget: action.target,
        outcomes: new Map(),
        selectedPacketId: null,
        view: 'history',
      }).targetSelection;
      if (!target) return;
      state.draft = {
        batchId: target.batchId,
        outcomes: new Map(),
        selectedPacketId: target.packetId,
        editingPacketId: null,
        view: 'history',
        reviewing: false,
      };
      clearConfirmationFailure();
    } else if (action.kind === 'view') {
      resetDraft(snapshot.accepted, action.view);
    } else if (action.kind === 'batch') {
      state.draft = {
        ...state.draft,
        batchId: action.batchId,
        outcomes: new Map(),
        selectedPacketId: null,
        editingPacketId: null,
        reviewing: false,
      };
      clearConfirmationFailure();
    } else if (action.kind === 'outcome') {
      const outcomes = new Map(state.draft.outcomes);
      outcomes.set(action.packetId, action.outcome);
      state.draft = { ...state.draft, outcomes, reviewing: false };
      clearConfirmationFailure();
    } else if (action.kind === 'all-outcomes') {
      state.draft = {
        ...state.draft,
        outcomes: new Map(
          snapshot.projection.activePackets.map(({ id }) => [id, action.outcome] as const),
        ),
        reviewing: false,
      };
      clearConfirmationFailure();
    } else if (action.kind === 'select-packet') {
      state.draft = {
        ...state.draft,
        selectedPacketId: state.draft.selectedPacketId === action.packetId ? null : action.packetId,
      };
    } else if (action.kind === 'edit-packet') {
      state.draft = {
        ...state.draft,
        editingPacketId: state.draft.editingPacketId === action.packetId ? null : action.packetId,
      };
    } else if (action.kind === 'review') {
      state.draft = { ...state.draft, reviewing: action.reviewing };
    }
    publish();
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    act,
  });
}
