import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdministratorAccount } from './AdministratorAccount.tsx';
import { ChurchAccount } from './ChurchAccount.tsx';

const roster = {
  administrators: [
    {
      id: 'member-you',
      userId: 'user-you',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      isCurrentUser: true,
    },
    {
      id: 'member-second',
      userId: 'user-second',
      name: 'Sam Taylor',
      email: 'sam@example.com',
      isCurrentUser: false,
    },
  ],
  invitations: [{ id: 'invitation-pending', email: 'jordan@example.com' }],
};

function render(accessKind, properties = {}) {
  return renderToStaticMarkup(
    createElement(ChurchAccount, {
      account: { churchName: 'Test Church', accessKind },
      administratorEmail: 'alex@example.com',
      initialRoster: roster,
      ...properties,
    }),
  );
}

test('Account shows the authenticated church access label without trial or payment actions', () => {
  const founding = render('founding');
  assert.match(founding, /Founding church access/);
  assert.match(
    founding,
    /Streetlight is provided to your church at no cost\. No payment is required\./,
  );
  const sponsored = render('sponsored');
  assert.match(sponsored, /Sponsored access/);
  assert.match(sponsored, /Your church has full access to Streetlight at no cost\./);
  assert.doesNotMatch(sponsored, /Founding church access/);
  const ordinary = render('standard');
  assert.match(ordinary, /Standard access/);
  assert.doesNotMatch(ordinary, /Founding church access|Sponsored access|at no cost/);
  for (const html of [founding, sponsored, ordinary]) {
    assert.match(html, /Test Church/);
    assert.doesNotMatch(html, /checkout|credit card|trial ends|subscribe|comped/i);
  }
});

test('administrator roster distinguishes the current user and pending invitations', () => {
  const html = render('founding');
  assert.match(html, /All administrators have full access to this church\./);
  assert.match(html, /Remove Sam Taylor/);
  assert.doesNotMatch(html, /Remove Alex Morgan/);
  assert.match(html, /Revoke invitation to jordan@example.com/);
  assert.match(html, /Invitation pending/);
  assert.match(html, /type="email"/);
  assert.match(html, /href="\/">Back to workspace|Back to workspace/);
});

test('an unavailable roster keeps the church account usable and disables invitations until retry', () => {
  const html = render('founding', {
    initialRoster: null,
    initialRosterError: 'Could not load administrators. Try again.',
  });
  assert.match(html, /Founding church access/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.match(html, /<button disabled="" type="submit">Invite administrator/);
});

test('the existing administrator menu links to Account and retains founder review and sign out', () => {
  const html = renderToStaticMarkup(
    createElement(AdministratorAccount, { email: 'alex@example.com', pendingPilotRequests: 2 }),
  );
  assert.match(html, /href="\/account"/);
  assert.match(html, /href="\/pilot-requests"/);
  assert.match(html, /href="\/logout"/);
  assert.match(html, /Administrator menu for alex@example.com/);
});
