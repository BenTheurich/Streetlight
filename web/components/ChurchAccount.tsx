'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChurchAccount as ChurchAccountDetails } from '@/lib/church-account';
import type { AdministratorAction, AdministratorRoster } from '@/lib/church-administrators';
import { AdministratorPage } from './AdministratorPage';
import { SUPPORT_EMAIL } from './PublicSiteFooter';

export type ChurchAccountProps = {
  account: ChurchAccountDetails;
  administratorEmail: string;
  initialRoster: AdministratorRoster | null;
  initialRosterError?: string;
  pendingPilotRequests?: number | null;
};

const accessLabels = {
  standard: 'Standard access',
  founding: 'Founding church access',
  sponsored: 'Sponsored access',
};

export function ChurchAccount({
  account,
  administratorEmail,
  initialRoster,
  initialRosterError = '',
  pendingPilotRequests,
}: ChurchAccountProps) {
  const [roster, setRoster] = useState(initialRoster);
  const [rosterError, setRosterError] = useState(initialRosterError);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const requestPending = useRef(false);
  const inviteInput = useRef<HTMLInputElement>(null);
  const cancelRemoval = useRef<HTMLButtonElement>(null);
  const removeTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (removing) cancelRemoval.current?.focus();
  }, [removing]);

  useEffect(() => {
    if (message && !busy) inviteInput.current?.focus();
  }, [message, busy]);

  async function refreshRoster() {
    try {
      const response = await fetch('/api/account/administrators', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load administrators. Try again.');
      const result = (await response.json()) as AdministratorRoster;
      setRoster(result);
      setRosterError('');
    } catch {
      setRosterError('Could not load administrators. Try again.');
    }
  }

  async function retryRoster() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    await refreshRoster();
    setBusy(false);
    requestPending.current = false;
  }

  async function mutate(action: AdministratorAction) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/account/administrators', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Could not update administrators. Try again.');
      setMessage(result.message || 'Administrators updated.');
      setRemoving(null);
      if (action.action === 'invite') setEmail('');
      await refreshRoster();
    } catch (failure) {
      setError(
        failure instanceof Error &&
          !(failure instanceof TypeError || failure instanceof SyntaxError)
          ? failure.message
          : 'Could not confirm the update. Refresh the list before trying again.',
      );
      await refreshRoster();
    } finally {
      setBusy(false);
      requestPending.current = false;
    }
  }

  const disabled = busy || !!rosterError || !roster;

  return (
    <AdministratorPage
      title="Church account"
      description={account.churchName}
      email={administratorEmail}
      pendingPilotRequests={pendingPilotRequests}
    >
      <section aria-labelledby="account-access-heading" className="account-access-section">
        <h2 id="account-access-heading">Access</h2>
        <div className="account-access">
          <h3>{accessLabels[account.accessKind]}</h3>
          {account.accessKind === 'founding' && (
            <p>Streetlight is provided to your church at no cost. No payment is required.</p>
          )}
          {account.accessKind === 'sponsored' && (
            <p>Your church has full access to Streetlight at no cost.</p>
          )}
        </div>
      </section>

      <section
        aria-labelledby="account-administrators-heading"
        className="account-administrators-section"
      >
        <h2 id="account-administrators-heading">Administrators</h2>
        <div className="account-administrators" aria-busy={busy}>
          <p className="account-permissions">All administrators have full access to this church.</p>
          <form
            className="account-invite"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({ action: 'invite', email });
            }}
          >
            <label htmlFor="administrator-invite-email">Email address</label>
            <div>
              <input
                autoComplete="email"
                disabled={disabled}
                id="administrator-invite-email"
                maxLength={254}
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                ref={inviteInput}
                required
                type="email"
                value={email}
              />
              <button disabled={disabled} type="submit">
                Invite administrator
              </button>
            </div>
          </form>
          <p className="account-feedback" role="status">
            {busy ? 'Updating administrators…' : message}
          </p>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          {rosterError && (
            <div className="account-roster-error">
              <p role="alert">{rosterError}</p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void retryRoster()}
                type="button"
              >
                {busy ? 'Loading…' : 'Retry'}
              </button>
            </div>
          )}
          {roster && (
            <ul aria-label="Church administrators and invitations" className="account-roster">
              {roster.administrators.map((administrator) => (
                <li key={administrator.id}>
                  <span aria-hidden="true" className="account-person-avatar">
                    {(administrator.name || administrator.email).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="account-person">
                    <strong>{administrator.name || administrator.email}</strong>
                    {administrator.name && <span>{administrator.email}</span>}
                  </div>
                  {administrator.isCurrentUser ? (
                    <span className="account-person-state">You</span>
                  ) : (
                    <button
                      aria-expanded={removing === administrator.id}
                      aria-label={`Remove ${administrator.name || administrator.email}`}
                      className="account-row-action"
                      disabled={disabled}
                      onClick={(event) => {
                        removeTrigger.current = event.currentTarget;
                        setRemoving(administrator.id);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                  {removing === administrator.id && (
                    <fieldset
                      aria-label="Confirm administrator removal"
                      className="account-remove-confirmation"
                    >
                      <p>
                        Remove <strong>{administrator.email}</strong> from {account.churchName}?{' '}
                        They will lose access to this church.
                      </p>
                      <div>
                        <button
                          className="danger"
                          disabled={disabled}
                          onClick={() => void mutate({ action: 'remove', id: administrator.id })}
                          type="button"
                        >
                          Remove administrator
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setRemoving(null);
                            removeTrigger.current?.focus();
                          }}
                          ref={cancelRemoval}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </fieldset>
                  )}
                </li>
              ))}
              {roster.invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span
                    aria-hidden="true"
                    className="account-person-avatar account-invitation-avatar"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    >
                      <rect x="3" y="5" width="14" height="10" rx="2" />
                      <path d="m4 6 6 5 6-5" />
                    </svg>
                  </span>
                  <div className="account-person">
                    <strong>{invitation.email}</strong>
                    <span>Invitation pending</span>
                  </div>
                  <button
                    aria-label={`Revoke invitation to ${invitation.email}`}
                    className="account-row-action"
                    disabled={disabled}
                    onClick={() => void mutate({ action: 'revoke', id: invitation.id })}
                    type="button"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <footer className="account-support">
        <span>Email support</span>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </footer>
    </AdministratorPage>
  );
}
