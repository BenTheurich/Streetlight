'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  type AccountActivity,
  accountActionLabels,
  type FounderAccountsSnapshot,
  type FounderChurchAccount,
  setupStatusLabels,
} from '@/lib/founder-account-types';
import { AdministratorPage } from './AdministratorPage';
import { FounderTerritoryMap } from './FounderTerritoryMap';

type AccountFilter = 'all' | 'setting_up' | 'ready' | 'issues';
type AccountSort = 'activity' | 'name' | 'packets';
const filters: Array<{ value: AccountFilter; label: string }> = [
  { value: 'all', label: 'All churches' },
  { value: 'setting_up', label: 'Setting up' },
  { value: 'ready', label: 'Ready' },
  { value: 'issues', label: 'Issues' },
];
const importStages: Record<string, string> = {
  queued: 'Waiting to start',
  downloading_streets: 'Downloading streets',
  downloading_buildings: 'Downloading buildings',
  matching: 'Matching homes to streets',
  preparing: 'Preparing street segments',
  saving: 'Saving territory',
};
const outcomes: Record<AccountActivity['outcome'], string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  rejected: 'Rejected',
  started: 'Started',
};

function date(value: string) {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

function recordedTime(value: string | null, timeZone = 'UTC') {
  if (!value) return 'No recorded activity';
  return date(value).toLocaleString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function number(value: number) {
  return value.toLocaleString('en-US');
}
function miles(value: number) {
  return `${number(value)} ${value === 1 ? 'mile' : 'miles'}`;
}
function activeIssues(church: FounderChurchAccount) {
  return church.issues.filter((issue) => !issue.resolvedAt);
}

export function visibleChurchAccounts(
  churches: FounderChurchAccount[],
  query: string,
  filter: AccountFilter,
  sort: AccountSort,
) {
  const search = query.trim().toLocaleLowerCase();
  return churches
    .filter((church) => {
      if (filter === 'ready' && church.setupStatus !== 'ready') return false;
      if (filter === 'setting_up' && church.setupStatus === 'ready') return false;
      if (filter === 'issues' && activeIssues(church).length === 0) return false;
      return [
        church.name,
        church.territory?.address,
        church.contact?.name,
        church.contact?.email,
        church.contact?.location,
        church.invitation?.email,
        ...church.administrators.flatMap((admin) => [admin.name, admin.email]),
      ].some((value) => value?.toLocaleLowerCase().includes(search));
    })
    .sort((left, right) => {
      if (sort === 'packets' && left.packets.total !== right.packets.total) {
        return right.packets.total - left.packets.total;
      }
      if (sort === 'activity') {
        const difference =
          (right.lastActivity ? date(right.lastActivity.recordedAt).getTime() : 0) -
          (left.lastActivity ? date(left.lastActivity.recordedAt).getTime() : 0);
        if (difference) return difference;
      }
      return left.name.localeCompare(right.name);
    });
}

export function FounderChurchDetail({ church }: { church: FounderChurchAccount }) {
  const [activities, setActivities] = useState(church.activities);
  const [hasMore, setHasMore] = useState(church.activityTotal > church.activities.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const territory = church.territory;
  const job = church.importJob;
  const currentIssues = activeIssues(church);

  useEffect(() => {
    setActivities(church.activities);
    setHasMore(church.activityTotal > church.activities.length);
    setError('');
  }, [church]);

  async function loadOlder() {
    if (pending.current || !hasMore) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const parameters = new URLSearchParams({ churchId: church.id });
      const before = activities.at(-1)?.id;
      if (before !== undefined) parameters.set('before', String(before));
      const response = await fetch(`/api/founder/church-accounts?${parameters}`, {
        cache: 'no-store',
      });
      const result = (await response.json()) as {
        activities: AccountActivity[];
        hasMore: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Could not load older activity. Try again.');
      setActivities((current) => [
        ...current,
        ...result.activities.filter((activity) => !current.some((item) => item.id === activity.id)),
      ]);
      setHasMore(result.hasMore);
    } catch {
      setError('Could not load older activity. Try again.');
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="founder-church-detail" id={`church-details-${church.id}`}>
      <div className="founder-detail-heading">
        <h3>{church.name}</h3>
        <span>Read-only account details</span>
      </div>
      <div className="founder-detail-columns">
        <section aria-label="Saved territory" className="founder-detail-section">
          <h4>Saved territory</h4>
          {territory ? (
            <>
              <FounderTerritoryMap territory={territory} churchName={church.name} />
              <p className="founder-territory-address">{territory.address}</p>
              <dl className="founder-facts">
                <div>
                  <dt>Boundary</dt>
                  <dd>
                    {miles(territory.distanceMiles)} ·{' '}
                    {territory.boundaryShape === 'circle'
                      ? 'Circle radius'
                      : 'Square boundary distance'}
                  </dd>
                </div>
                <div>
                  <dt>Estimated homes</dt>
                  <dd>{number(territory.estimatedHomes)}</dd>
                </div>
                <div>
                  <dt>Street segments</dt>
                  <dd>{number(territory.segmentCount)}</dd>
                </div>
                <div>
                  <dt>Last successful import</dt>
                  <dd>
                    {territory.importCompletedAt
                      ? recordedTime(territory.importCompletedAt, church.timeZone)
                      : 'No successful import recorded'}
                  </dd>
                </div>
              </dl>
              {territory.warnings.length > 0 && (
                <div className="founder-territory-warnings">
                  <h5>Data warnings</h5>
                  <ul>
                    {territory.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>No territory has been saved yet.</p>
          )}
          {job && (
            <div className="founder-import">
              <h5>
                Latest import ·{' '}
                {job.status === 'succeeded'
                  ? 'Completed'
                  : job.status === 'interrupted'
                    ? 'Interrupted'
                    : job.status === 'failed'
                      ? 'Failed'
                      : job.status === 'running'
                        ? 'Running'
                        : 'Queued'}
              </h5>
              <p>
                {job.status === 'succeeded'
                  ? 'Territory saved.'
                  : (importStages[job.stage] ?? 'Preparing territory')}
              </p>
              <p>
                Attempted: {job.attemptedAddress}, {miles(job.attemptedDistanceMiles)} ·{' '}
                {job.attemptedBoundaryShape === 'circle'
                  ? 'Circle radius'
                  : 'Square boundary distance'}
              </p>
              <p>
                {recordedTime(job.createdAt, church.timeZone)}
                {job.completedAt
                  ? ` · Finished ${recordedTime(job.completedAt, church.timeZone)}`
                  : ''}
              </p>
              {job.error && <p className="founder-issue-text">{job.error}</p>}
              {territory?.importCompletedAt &&
                (job.status === 'failed' || job.status === 'interrupted') && (
                  <p>The previously saved territory remains available.</p>
                )}
            </div>
          )}
        </section>
        <div>
          <section aria-label="Outreach totals" className="founder-detail-section">
            <h4>Outreach totals</h4>
            <dl className="founder-facts">
              <div>
                <dt>Batches finalized</dt>
                <dd>{number(church.packets.batches)}</dd>
              </div>
              <div>
                <dt>Packets finalized</dt>
                <dd>{number(church.packets.total)}</dd>
              </div>
              <div>
                <dt>Active packets</dt>
                <dd>{number(church.packets.active)}</dd>
              </div>
              <div>
                <dt>Completed packets</dt>
                <dd>{number(church.packets.completed)}</dd>
              </div>
              <div>
                <dt>Cancelled packets</dt>
                <dd>{number(church.packets.cancelled)}</dd>
              </div>
              <div>
                <dt>Resolved packets</dt>
                <dd>{number(church.packets.completed + church.packets.cancelled)}</dd>
              </div>
              <div>
                <dt>Estimated homes reached</dt>
                <dd>{number(church.packets.estimatedHomesReached)}</dd>
              </div>
            </dl>
            <p className="founder-explanation">
              Finalized assignments count once. Previews and PDF retries do not add packets. A
              prepared PDF does not confirm printing. Completed and cancelled packets remain
              separate.
            </p>
            <p className="founder-explanation">
              Estimated homes reached counts all-time unique estimated homes in the current saved
              territory. Corrections and undo apply.
            </p>
          </section>
          <section aria-label="Administrators" className="founder-detail-section">
            <h4>Administrators</h4>
            {!church.identityAvailable ? (
              <p className="founder-issue-text">
                Could not check WorkOS membership or invitation status. Refresh accounts to try
                again.
              </p>
            ) : (
              <>
                {church.administrators.length === 0 && <p>No active administrators.</p>}
                <ul className="founder-admin-list">
                  {church.administrators.map((admin) => (
                    <li key={admin.userId}>
                      <strong>{admin.name || admin.email}</strong>
                      {admin.name && <span>{admin.email}</span>}
                      <span>
                        Last recorded action: {recordedTime(admin.lastActivityAt, church.timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
                {church.pendingInvitations.length > 0 && (
                  <>
                    <h5>Pending invitations</h5>
                    <ul className="founder-admin-list">
                      {church.pendingInvitations.map((invitation) => (
                        <li key={invitation.id}>
                          <strong>{invitation.email}</strong>
                          <span>Invitation pending</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
            {church.invitation && (
              <p className="founder-explanation">
                First invitation: {church.invitation.email} ·{' '}
                {church.invitation.state === 'unavailable'
                  ? 'Status unavailable'
                  : church.invitation.state}
                {church.invitation.acceptedAt
                  ? ` on ${recordedTime(church.invitation.acceptedAt, church.timeZone)}`
                  : ''}
              </p>
            )}
            {church.contact && (
              <p className="founder-explanation">
                Request contact: {church.contact.name} · {church.contact.email} ·{' '}
                {church.contact.location}
              </p>
            )}
          </section>
        </div>
      </div>
      <section aria-label="Issues and recovery" className="founder-detail-section">
        <h4>
          Issues and recovery{' '}
          {currentIssues.length > 0 && (
            <span className="founder-issue-count">{currentIssues.length} current</span>
          )}
        </h4>
        <p className="founder-explanation">
          These are recorded failures and data warnings. Unreported browser problems and confusion
          do not appear here.
        </p>
        {church.issues.length === 0 ? (
          <p>No recorded issues.</p>
        ) : (
          <ul className="founder-issue-list">
            {church.issues.map((issue) => (
              <li key={issue.id}>
                <div>
                  <strong className={!issue.resolvedAt ? 'founder-issue-text' : undefined}>
                    {issue.resolvedAt ? 'Recovered' : 'Current issue'}
                  </strong>
                  <span>{issue.message}</span>
                </div>
                <span>
                  {issue.occurredAt
                    ? recordedTime(issue.occurredAt, church.timeZone)
                    : 'Recorded on saved territory'}
                  {issue.resolvedAt
                    ? ` · Recovered ${recordedTime(issue.resolvedAt, church.timeZone)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Recent activity" className="founder-detail-section">
        <h4>Recent activity</h4>
        <p className="founder-explanation">
          {number(church.activityTotal)} recorded{' '}
          {church.activityTotal === 1 ? 'action' : 'actions'}. Times use {church.timeZone}. Older
          actions without an actor remain unattributed.
        </p>
        {activities.length === 0 ? (
          <p>No activity recorded yet. Tracking begins when this feature is deployed.</p>
        ) : (
          <ol className="founder-activity-list">
            {activities.map((activity) => (
              <li key={activity.id}>
                <div>
                  <strong>{accountActionLabels[activity.action]}</strong>
                  <span className={`founder-activity-outcome outcome-${activity.outcome}`}>
                    {outcomes[activity.outcome]}
                  </span>
                </div>
                <span>
                  {activity.actorName ||
                    activity.actorEmail ||
                    (activity.userId ? 'Recorded administrator' : 'Actor not recorded')}
                  {activity.actorName && activity.actorEmail ? ` · ${activity.actorEmail}` : ''}
                </span>
                <time dateTime={date(activity.recordedAt).toISOString()}>
                  {recordedTime(activity.recordedAt, church.timeZone)}
                </time>
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="founder-issue-text" role="alert">
            {error}
          </p>
        )}
        {hasMore && (
          <button
            className="secondary founder-load-older"
            type="button"
            onClick={() => void loadOlder()}
            disabled={loading}
          >
            {loading ? 'Loading activity…' : 'Load older activity'}
          </button>
        )}
      </section>
    </div>
  );
}

export function FounderChurchAccounts({
  initialSnapshot,
  administratorEmail,
  pendingPilotRequests,
}: {
  initialSnapshot: FounderAccountsSnapshot;
  administratorEmail: string;
  pendingPilotRequests: number;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [sort, setSort] = useState<AccountSort>('activity');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    const selectFromHash = () => {
      if (!window.location.hash.startsWith('#church-')) return;
      try {
        setSelectedId(decodeURIComponent(window.location.hash.slice('#church-'.length)));
      } catch {
        /* Ignore an invalid link fragment. */
      }
    };
    selectFromHash();
    window.addEventListener('hashchange', selectFromHash);
    return () => window.removeEventListener('hashchange', selectFromHash);
  }, []);

  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch('/api/founder/church-accounts', { cache: 'no-store' });
      const result = (await response.json()) as FounderAccountsSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error);
      setSnapshot(result);
    } catch {
      setError('Could not refresh accounts. The previous snapshot is still shown. Try again.');
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  }

  const churches = visibleChurchAccounts(snapshot.churches, query, filter, sort);
  const unavailable = snapshot.churches.some((church) => !church.identityAvailable);

  return (
    <AdministratorPage
      title="Church accounts"
      description="See each church's setup, outreach, administrators, and recorded issues."
      email={administratorEmail}
      pendingPilotRequests={pendingPilotRequests}
    >
      <div className="founder-account-overview">
        <div className="founder-account-update">
          <p>
            {number(snapshot.churches.length)}{' '}
            {snapshot.churches.length === 1 ? 'church' : 'churches'} · Checked{' '}
            {recordedTime(snapshot.checkedAt)} UTC
          </p>
          <button
            className="secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh accounts'}
          </button>
        </div>
        {error && (
          <p className="founder-account-warning" role="alert">
            {error}
          </p>
        )}
        {unavailable && (
          <p className="founder-account-warning" role="status">
            WorkOS status is unavailable for some churches. Local territory and packet records
            remain visible. Refresh accounts to check invitations and administrators again.
          </p>
        )}
        <div className="founder-account-controls">
          <label>
            Find a church or administrator
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Church, address, name, or email"
            />
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(event) => setSort(event.target.value as AccountSort)}>
              <option value="activity">Latest activity</option>
              <option value="name">Church name</option>
              <option value="packets">Packets finalized</option>
            </select>
          </label>
        </div>
        <fieldset className="founder-account-filters" aria-label="Filter church accounts">
          {filters.map((item) => (
            <button
              type="button"
              className="secondary"
              aria-pressed={filter === item.value}
              key={item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span>
                {number(visibleChurchAccounts(snapshot.churches, '', item.value, 'name').length)}
              </span>
            </button>
          ))}
        </fieldset>
        <p className="founder-result-count" role="status">
          {number(churches.length)} {churches.length === 1 ? 'church' : 'churches'} shown
        </p>
        {churches.length === 0 ? (
          <div className="founder-account-empty">
            <h2>{snapshot.churches.length ? 'No matching churches' : 'No church accounts yet'}</h2>
            <p>
              {snapshot.churches.length
                ? 'Try a different search or choose All churches.'
                : 'Approved access requests will appear here after a church account is created.'}
            </p>
            <a href="/pilot-requests">Review access requests</a>
          </div>
        ) : (
          <table className="founder-account-table">
            <caption className="founder-visually-hidden">
              Church accounts. Select a church name to show its details.
            </caption>
            <thead>
              <tr>
                <th scope="col">Church and setup</th>
                <th scope="col">Territory</th>
                <th scope="col">Packets</th>
                <th scope="col">Latest activity and issues</th>
              </tr>
            </thead>
            <tbody>
              {churches.map((church) => {
                const issues = activeIssues(church);
                const selected = selectedId === church.id;
                return (
                  <Fragment key={church.id}>
                    <tr
                      id={`church-${church.id}`}
                      className={selected ? 'founder-selected-row' : undefined}
                    >
                      <td>
                        <button
                          className="founder-church-name"
                          type="button"
                          aria-expanded={selected}
                          aria-controls={`church-details-${church.id}`}
                          onClick={() => setSelectedId(selected ? null : church.id)}
                        >
                          {church.name}
                          <svg aria-hidden="true" viewBox="0 0 20 20">
                            <path
                              d="m5 8 5 5 5-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                          </svg>
                        </button>
                        <span className={`founder-setup-status setup-${church.setupStatus}`}>
                          {setupStatusLabels[church.setupStatus]}
                        </span>
                        <span className="founder-row-secondary">
                          {church.administrators.length > 0
                            ? church.administrators
                                .map((admin) => admin.name || admin.email)
                                .join(', ')
                            : (church.invitation?.email ??
                              church.contact?.email ??
                              'No administrator recorded')}
                        </span>
                      </td>
                      <td>
                        <span className="founder-mobile-label">Territory</span>
                        {church.territory ? (
                          <>
                            <span>{church.territory.address}</span>
                            <span className="founder-row-secondary">
                              {miles(church.territory.distanceMiles)} ·{' '}
                              {church.territory.boundaryShape === 'circle'
                                ? 'Circle radius'
                                : 'Square boundary distance'}
                            </span>
                          </>
                        ) : (
                          <span className="founder-row-secondary">
                            Not saved yet
                            {church.contact?.location ? ` · ${church.contact.location}` : ''}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="founder-mobile-label">Packets</span>
                        <strong>{number(church.packets.total)} finalized</strong>
                        <span className="founder-row-secondary">
                          {number(church.packets.active)} active ·{' '}
                          {number(church.packets.completed)} completed ·{' '}
                          {number(church.packets.cancelled)} cancelled
                        </span>
                      </td>
                      <td>
                        <span className="founder-mobile-label">Latest activity</span>
                        {church.lastActivity ? (
                          <>
                            <span>
                              {accountActionLabels[church.lastActivity.action]} ·{' '}
                              {outcomes[church.lastActivity.outcome]}
                            </span>
                            <span className="founder-row-secondary">
                              {recordedTime(church.lastActivity.recordedAt, church.timeZone)}
                            </span>
                          </>
                        ) : (
                          <span className="founder-row-secondary">No recorded activity</span>
                        )}
                        <span
                          className={issues.length ? 'founder-issue-text' : 'founder-row-secondary'}
                        >
                          {issues.length
                            ? `${number(issues.length)} current ${issues.length === 1 ? 'issue' : 'issues'}`
                            : 'No current recorded issues'}
                        </span>
                      </td>
                    </tr>
                    {selected && (
                      <tr className="founder-detail-row">
                        <td colSpan={4}>
                          <FounderChurchDetail key={church.id} church={church} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdministratorPage>
  );
}
