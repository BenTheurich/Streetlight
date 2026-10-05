import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FounderChurchAccounts,
  FounderChurchDetail,
  visibleChurchAccounts,
} from './FounderChurchAccounts.tsx';

const action = {
  id: 2,
  churchId: 'church-a',
  userId: 'user-zack',
  actorName: 'Zack',
  actorEmail: 'zack@example.com',
  action: 'batch_finalization',
  outcome: 'succeeded',
  targetId: 'batch-1',
  recordedAt: '2026-10-04 12:30:00',
};
const account = {
  id: 'church-a',
  name: 'Grace Church',
  timeZone: 'America/Los_Angeles',
  accessLabel: 'standard',
  createdAt: '2026-10-01 12:00:00',
  contact: { name: 'Zack', email: 'zack@example.com', location: 'Temecula, CA' },
  setupStatus: 'ready',
  invitation: { state: 'accepted', email: 'zack@example.com', acceptedAt: '2026-10-02T12:00:00Z' },
  identityAvailable: true,
  administrators: [
    {
      userId: 'user-zack',
      name: 'Zack',
      email: 'zack@example.com',
      lastActivityAt: action.recordedAt,
    },
  ],
  pendingInvitations: [{ id: 'invite-a', email: 'sam@example.com' }],
  territory: {
    id: 'territory-a',
    address: '100 Main Street, Temecula, CA',
    center: [-117.1, 33.5],
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [-117.11, 33.49],
          [-117.09, 33.49],
          [-117.09, 33.51],
          [-117.11, 33.49],
        ],
      ],
    },
    distanceMiles: 2.5,
    boundaryShape: 'circle',
    estimatedHomes: 850,
    segmentCount: 67,
    importCompletedAt: '2026-10-03 12:00:00',
    warnings: ['Some addresses could not be matched.'],
  },
  importJob: {
    id: 'import-a',
    status: 'failed',
    stage: 'matching',
    createdAt: '2026-10-04 09:00:00',
    completedAt: '2026-10-04 09:10:00',
    error: 'Street data preparation failed.',
    attemptedAddress: '200 Oak Street',
    attemptedDistanceMiles: 3,
    attemptedBoundaryShape: 'square',
  },
  packets: {
    batches: 2,
    total: 10,
    active: 3,
    completed: 5,
    cancelled: 2,
    estimatedHomesReached: 125,
  },
  lastActivity: action,
  activities: [
    action,
    {
      ...action,
      id: 1,
      userId: null,
      actorName: null,
      actorEmail: null,
      action: 'geocoding',
      outcome: 'failed',
    },
  ],
  activityTotal: 61,
  issues: [
    {
      id: 'issue-a',
      message: 'Street data preparation failed.',
      occurredAt: '2026-10-04 09:10:00',
      resolvedAt: null,
    },
    {
      id: 'issue-old',
      message: 'Address lookup failed.',
      occurredAt: '2026-10-02 08:00:00',
      resolvedAt: '2026-10-02 08:05:00',
    },
  ],
};

function render(churches = [account]) {
  return renderToStaticMarkup(
    createElement(FounderChurchAccounts, {
      initialSnapshot: { churches, checkedAt: '2026-10-05T10:00:00Z' },
      administratorEmail: 'founder@example.com',
      pendingPilotRequests: 1,
    }),
  );
}

test('founder overview shows setup, saved territory, truthful packet counts, activity and issues', () => {
  const html = render();
  for (const expected of [
    'Grace Church',
    'Ready',
    '2.5 miles',
    'Circle radius',
    '10 finalized',
    '3 active',
    '5 completed',
    '2 cancelled',
    'Batch finalized',
    '1 current issue',
    'Refresh accounts',
  ]) {
    assert.ok(html.includes(expected), expected);
  }
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Filter church accounts"/);
  assert.doesNotMatch(html, /Invitation sent/);
});

test('search includes administrators and address; filters count only current issues; sorting is stable', () => {
  const setup = {
    ...account,
    id: 'church-b',
    name: 'Bethel Church',
    setupStatus: 'accepted',
    lastActivity: null,
    territory: null,
    issues: [account.issues[1]],
    packets: { ...account.packets, total: 20 },
  };
  assert.deepEqual(
    visibleChurchAccounts([setup, account], 'zack', 'ready', 'name').map((church) => church.id),
    ['church-a'],
  );
  assert.deepEqual(
    visibleChurchAccounts([setup, account], 'Main Street', 'all', 'name').map(
      (church) => church.id,
    ),
    ['church-a'],
  );
  assert.deepEqual(
    visibleChurchAccounts([setup, account], '', 'issues', 'name').map((church) => church.id),
    ['church-a'],
  );
  assert.deepEqual(
    visibleChurchAccounts([setup, account], '', 'setting_up', 'name').map((church) => church.id),
    ['church-b'],
  );
  assert.deepEqual(
    visibleChurchAccounts([setup, account], '', 'all', 'activity').map((church) => church.id),
    ['church-a', 'church-b'],
  );
  assert.deepEqual(
    visibleChurchAccounts([setup, account], '', 'all', 'packets').map((church) => church.id),
    ['church-b', 'church-a'],
  );
});

test('church details distinguish attempted import, retained territory, admins, recovered issues and actorless history', () => {
  const html = renderToStaticMarkup(createElement(FounderChurchDetail, { church: account }));
  for (const expected of [
    'Saved territory',
    '100 Main Street',
    'Attempted: 200 Oak Street',
    'Square boundary distance',
    'previously saved territory remains available',
    'Batches finalized',
    'Packets finalized',
    'Resolved packets',
    'Estimated homes reached',
    'prepared PDF does not confirm printing',
    'sam@example.com',
    'Invitation pending',
    'Recovered',
    'Current issue',
    'Actor not recorded',
    '61 recorded actions',
    'Load older activity',
  ]) {
    assert.ok(html.includes(expected), expected);
  }
  assert.match(html, /dateTime="2026-10-04T12:30:00.000Z"/);
});

test('provider failure preserves local records without claiming an empty administrator roster', () => {
  const unavailable = {
    ...account,
    identityAvailable: false,
    administrators: [],
    pendingInvitations: [],
    invitation: { ...account.invitation, state: 'unavailable' },
  };
  const html = render([unavailable]);
  assert.match(html, /WorkOS status is unavailable/);
  assert.match(html, /10 finalized/);
  const detail = renderToStaticMarkup(createElement(FounderChurchDetail, { church: unavailable }));
  assert.match(detail, /Could not check WorkOS membership or invitation status/);
  assert.doesNotMatch(detail, /No active administrators/);
});

test('a failed latest action is labeled with its outcome in the overview', () => {
  assert.match(
    render([{ ...account, lastActivity: { ...action, outcome: 'failed' } }]),
    /Batch finalized · Failed/,
  );
});

test('empty account state explains how accounts appear', () => {
  const html = render([]);
  assert.match(html, /No church accounts yet/);
  assert.match(html, /Review access requests/);
});
