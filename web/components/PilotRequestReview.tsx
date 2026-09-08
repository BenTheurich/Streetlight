'use client';

import { useRef, useState } from 'react';
import type { PilotRequest } from '@/lib/pilot-requests';
import { AdministratorPage } from './AdministratorPage';

const statusLabels = {
  pending: 'Awaiting review',
  declined: 'Declined',
  provisioning: 'Approval incomplete',
  approved: 'Invitation sent',
};

export function PilotRequestReview({
  initialRequests,
  administratorEmail,
}: {
  initialRequests: PilotRequest[];
  administratorEmail: string;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [message, setMessage] = useState('');
  const requestPending = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);

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
      const result = (await response.json()) as { request: PilotRequest } | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error(
          'error' in result ? result.error : 'Could not update this request. Try again.',
        );
      }
      setRequests((current) =>
        current.map((item) => (item.id === result.request.id ? result.request : item)),
      );
      setMessage(
        action === 'decline'
          ? `${request.churchName} was declined. No invitation was sent.`
          : `Invitation sent to ${result.request.inviteEmail ?? result.request.email}.`,
      );
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
    return (
      <details className="pilot-review-card" key={request.id} open={needsReview}>
        <summary>
          <div className="pilot-review-summary">
            <h3>{request.approvedChurchName ?? request.churchName}</h3>
            <p>
              {request.contactName} · {request.location}
            </p>
          </div>
          <span className={`pilot-review-status status-${request.status}`}>
            {statusLabels[request.status]}
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
              <p>
                Invitation sent to <strong>{request.inviteEmail ?? request.email}</strong>.
              </p>
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
                  disabled={busy !== null}
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
                  disabled={busy !== null}
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
                    disabled={busy !== null}
                    onClick={() => void review(request, 'decline')}
                  >
                    {currentAction === 'decline' ? 'Declining…' : 'Decline'}
                  </button>
                )}
                <button type="submit" disabled={busy !== null}>
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
