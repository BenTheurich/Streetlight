'use client';

import { useRef, useState } from 'react';
import type { FounderChurchAccount } from '@/lib/founder-account-types';
import type { PilotRequest } from '@/lib/pilot-requests';
import { AdministratorPage } from './AdministratorPage';

const statusLabels = {
  pending: 'Awaiting review',
  declined: 'Declined',
  provisioning: 'Approval incomplete',
  approved: 'Approved',
};

const invitationLabels = {
  pending: 'Invitation pending',
  accepted: 'Invitation accepted',
  expired: 'Invitation expired',
  revoked: 'Invitation revoked',
  unavailable: 'Invitation status unavailable',
};

export function PilotRequestReview({
  initialRequests,
  administratorEmail,
  invitationStatuses = {},
}: {
  initialRequests: PilotRequest[];
  administratorEmail: string;
  invitationStatuses?: Record<string, NonNullable<FounderChurchAccount['invitation']>>;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [invitations, setInvitations] = useState(invitationStatuses);
  const [busy, setBusy] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const requestPending = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);

  async function refreshStatuses() {
    if (requestPending.current) return;
    requestPending.current = true;
    setRefreshing(true);
    setRefreshError('');
    try {
      const response = await fetch('/api/founder/pilot-requests', { cache: 'no-store' });
      const result = (await response.json()) as {
        requests: PilotRequest[];
        invitationStatuses: typeof invitationStatuses;
      };
      if (!response.ok) throw new Error('Could not refresh request status.');
      setRequests(result.requests);
      setInvitations(result.invitationStatuses);
      setMessage('Access requests and invitation statuses refreshed.');
    } catch {
      setRefreshError(
        'Could not refresh invitation statuses. Previous results are still shown. Try again.',
      );
    } finally {
      requestPending.current = false;
      setRefreshing(false);
    }
  }

  async function review(
    request: PilotRequest,
    action: 'approve' | 'decline',
    form?: HTMLFormElement,
  ) {
    if (requestPending.current || request.status === 'approved') return;
    if (action === 'decline' && request.status !== 'pending') return;
    requestPending.current = true;
    setBusy({ id: request.id, action });
    setError(null);
    setMessage('');
    const data = form ? new FormData(form) : null;
    const body =
      action === 'approve'
        ? { action, id: request.id, churchName: data?.get('churchName'), email: data?.get('email') }
        : { action, id: request.id };
    try {
      const response = await fetch('/api/founder/pilot-requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as
        | { request: PilotRequest; invitation: FounderChurchAccount['invitation'] }
        | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error(
          'error' in result ? result.error : 'Could not update this request. Try again.',
        );
      }
      setRequests((current) =>
        current.map((item) => (item.id === result.request.id ? result.request : item)),
      );
      if (action === 'approve') {
        const invitation: NonNullable<FounderChurchAccount['invitation']> = result.invitation ?? {
          state: 'unavailable',
          email: result.request.inviteEmail ?? result.request.email,
          acceptedAt: null,
        };
        setInvitations((current) => ({
          ...current,
          [result.request.id]: invitation,
        }));
        setMessage(
          invitation.state === 'unavailable'
            ? 'Approved. Could not check the invitation status. Refresh invitation statuses to try again.'
            : `${invitationLabels[invitation.state]} for ${invitation.email}.`,
        );
      } else {
        setMessage(`${request.churchName} was declined. No invitation was sent.`);
      }
      // The completed request moves to Reviewed, so keep keyboard focus at its outcome.
      feedback.current?.focus();
    } catch (failure) {
      setError({
        id: request.id,
        message:
          failure instanceof Error &&
          !(failure instanceof TypeError || failure instanceof SyntaxError)
            ? failure.message
            : 'Could not confirm the update. Refresh this page before trying again.',
      });
    } finally {
      setBusy(null);
      requestPending.current = false;
    }
  }

  const pending = requests.filter(
    (request) => request.status === 'pending' || request.status === 'provisioning',
  );
  const reviewed = requests.filter(
    (request) => request.status === 'declined' || request.status === 'approved',
  );

  function requestCard(request: PilotRequest) {
    const needsReview = request.status === 'pending' || request.status === 'provisioning';
    const currentAction = busy?.id === request.id ? busy.action : null;
    const invitation = invitations[request.id];
    const invitationState = invitation?.state ?? 'unavailable';
    return (
      <details className="pilot-review-card" key={request.id} open={needsReview}>
        <summary>
          <div className="pilot-review-summary">
            <h3>{request.approvedChurchName ?? request.churchName}</h3>
            <p>
              {request.contactName} · {request.location}
            </p>
          </div>
          <span
            className={`pilot-review-status status-${request.status}`}
            data-invitation-state={request.status === 'approved' ? invitationState : undefined}
          >
            {request.status === 'approved'
              ? invitationLabels[invitationState]
              : statusLabels[request.status]}
          </span>
          <svg aria-hidden="true" className="pilot-review-chevron" viewBox="0 0 20 20">
            <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </summary>
        <div className="pilot-review-body">
          <div className="pilot-review-context">
            <p className="pilot-review-contact">
              <a href={`mailto:${request.email}`}>{request.email}</a>
            </p>
            {request.outreachProcess && (
              <div className="pilot-review-process">
                <h4>Current outreach</h4>
                <p>{request.outreachProcess}</p>
              </div>
            )}
            {request.status === 'declined' && (
              <p>No invitation was sent. You can still approve this request.</p>
            )}
            {request.status === 'provisioning' && (
              <p>Approval was started. Continue to finish sending the invitation.</p>
            )}
            {request.status === 'approved' && (
              <>
                <p>
                  {invitationState === 'unavailable'
                    ? 'Approved. Could not check the invitation status. Refresh this page to try again.'
                    : `${invitationLabels[invitationState]} for `}
                  {invitationState !== 'unavailable' && (
                    <>
                      <strong>{invitation?.email ?? request.inviteEmail ?? request.email}</strong>.
                    </>
                  )}
                </p>
                {request.provisionedChurchId && (
                  <p>
                    <a
                      href={`/church-accounts#church-${encodeURIComponent(request.provisionedChurchId)}`}
                    >
                      View church account
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
          {request.status !== 'approved' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void review(request, 'approve', event.currentTarget);
              }}
              aria-busy={currentAction !== null}
            >
              <label>
                Church name
                <input
                  name="churchName"
                  defaultValue={request.approvedChurchName ?? request.churchName}
                  maxLength={160}
                  disabled={busy !== null || refreshing}
                  required
                />
              </label>
              <label>
                Invitation email
                <input
                  name="email"
                  type="email"
                  defaultValue={request.inviteEmail ?? request.email}
                  maxLength={254}
                  disabled={busy !== null || refreshing}
                  required
                />
              </label>
              {error?.id === request.id && (
                <p className="pilot-review-error" role="alert">
                  {error.message}
                </p>
              )}
              <div className="pilot-review-actions">
                {request.status === 'pending' && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy !== null || refreshing}
                    onClick={() => void review(request, 'decline')}
                  >
                    {currentAction === 'decline' ? 'Declining…' : 'Decline'}
                  </button>
                )}
                <button type="submit" disabled={busy !== null || refreshing}>
                  {currentAction === 'approve'
                    ? 'Sending invitation…'
                    : request.status === 'provisioning'
                      ? 'Continue approval'
                      : 'Approve and invite'}
                </button>
              </div>
            </form>
          )}
        </div>
      </details>
    );
  }

  return (
    <AdministratorPage
      title="Access requests"
      description="Review church requests and invite their first administrator."
      email={administratorEmail}
      pendingPilotRequests={pending.length}
    >
      <p className="pilot-review-feedback" role="status" ref={feedback} tabIndex={-1}>
        {message}
      </p>
      <div className="pilot-review-update">
        <button
          className="secondary"
          type="button"
          onClick={() => void refreshStatuses()}
          disabled={busy !== null || refreshing}
        >
          {refreshing ? 'Refreshing statuses…' : 'Refresh invitation statuses'}
        </button>
        {refreshError && (
          <p className="pilot-review-error" role="alert">
            {refreshError}
          </p>
        )}
      </div>
      <section className="pilot-review-group" aria-labelledby="requests-pending-heading">
        <h2 id="requests-pending-heading">
          Needs review <span className="pilot-review-count">{pending.length}</span>
        </h2>
        {pending.length > 0 ? (
          <div className="pilot-review-list">{pending.map(requestCard)}</div>
        ) : (
          <div className="pilot-review-empty">
            <p>No requests waiting for review.</p>
            <span>New church requests will appear here.</span>
          </div>
        )}
      </section>
      {reviewed.length > 0 && (
        <section className="pilot-review-group" aria-labelledby="requests-reviewed-heading">
          <h2 id="requests-reviewed-heading">
            Reviewed <span className="pilot-review-count">{reviewed.length}</span>
          </h2>
          <div className="pilot-review-list">{reviewed.map(requestCard)}</div>
        </section>
      )}
    </AdministratorPage>
  );
}
