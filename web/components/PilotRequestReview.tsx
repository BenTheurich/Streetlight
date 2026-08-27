'use client';

import { useState } from 'react';
import type { PilotRequest } from '@/lib/pilot-requests';

export function PilotRequestReview({ initialRequests }: { initialRequests: PilotRequest[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function review(
    request: PilotRequest,
    action: 'approve' | 'decline',
    form?: HTMLFormElement,
  ) {
    setBusy(request.id);
    setError('');
    const data = form ? new FormData(form) : null;
    const body =
      action === 'approve'
        ? {
            action,
            id: request.id,
            churchName: data?.get('churchName'),
            email: data?.get('email'),
          }
        : { action, id: request.id };
    try {
      const response = await fetch('/api/founder/pilot-requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { request: PilotRequest } | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Review failed');
      }
      setRequests((current) =>
        current.map((item) => (item.id === result.request.id ? result.request : item)),
      );
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Review failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="pilot-review-page">
      <header>
        <div>
          <p>STREETLIGHT PILOT</p>
          <h1>Pilot access requests</h1>
        </div>
        <a href="/">Back to Streetlight</a>
      </header>
      {error && <p className="pilot-review-error">{error}</p>}
      <div className="pilot-review-list">
        {requests.map((request) => (
          <article className="pilot-review-card" key={request.id}>
            <div className="pilot-review-summary">
              <span className={`pilot-review-status status-${request.status}`}>
                {request.status}
              </span>
              <h2>{request.churchName}</h2>
              <p>
                {request.contactName} · {request.email}
              </p>
              <p>{request.location}</p>
              {request.outreachProcess && <blockquote>{request.outreachProcess}</blockquote>}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void review(request, 'approve', event.currentTarget);
              }}
            >
              <label>
                Church name
                <input
                  name="churchName"
                  defaultValue={request.approvedChurchName ?? request.churchName}
                  required
                />
              </label>
              <label>
                Invite email
                <input
                  name="email"
                  type="email"
                  defaultValue={request.inviteEmail ?? request.email}
                  required
                />
              </label>
              <div>
                <button
                  type="button"
                  disabled={busy === request.id || request.status === 'approved'}
                  onClick={() => void review(request, 'decline')}
                >
                  Decline
                </button>
                <button
                  type="submit"
                  disabled={busy === request.id || request.status === 'approved'}
                >
                  {busy === request.id ? 'Working…' : 'Approve and invite'}
                </button>
              </div>
            </form>
          </article>
        ))}
        {requests.length === 0 && <p>No pilot requests yet.</p>}
      </div>
    </main>
  );
}
