import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PilotRequestReview } from './PilotRequestReview.tsx';

function render(status, invitationState) {
  return renderToStaticMarkup(
    createElement(PilotRequestReview, {
      administratorEmail: 'founder@example.com',
      invitationStatuses: invitationState
        ? {
            'request-test': { state: invitationState, email: 'alex@example.com', acceptedAt: null },
          }
        : {},
      initialRequests: [
        {
          id: 'request-test',
          churchName: 'Test Church',
          contactName: 'Alex Morgan',
          email: 'alex@example.com',
          location: 'Temecula, CA',
          outreachProcess: 'Printed packets on Saturdays.',
          status,
          approvedChurchName: null,
          inviteEmail: null,
          provisionedChurchId: status === 'approved' ? 'church-test' : null,
          authOrganizationId: null,
          authInvitationId: null,
          createdAt: '2026-09-08T12:00:00Z',
          updatedAt: '2026-09-08T12:00:00Z',
          decidedAt: null,
        },
      ],
    }),
  );
}

test('pending access requests offer decline and approval', () => {
  const html = render('pending');
  assert.match(html, />Decline<\/button>/);
  assert.match(html, />Approve and invite<\/button>/);
});

test('declined requests retain later approval without an ineffective repeat Decline action', () => {
  const html = render('declined');
  assert.doesNotMatch(html, />Decline<\/button>/);
  assert.match(html, />Approve and invite<\/button>/);
  assert.match(html, /No invitation was sent/);
});

test('partially approved requests can resume approval but cannot be declined', () => {
  const html = render('provisioning');
  assert.doesNotMatch(html, />Decline<\/button>/);
  assert.match(html, />Continue approval<\/button>/);
});

test('approved requests show the invitation outcome without review actions', () => {
  const html = render('approved', 'accepted');
  assert.doesNotMatch(html, /<form|>Decline<\/button>|>Approve and invite<\/button>/);
  assert.match(html, /Invitation accepted/);
  assert.doesNotMatch(html, /Invitation sent/);
  assert.match(html, /href="\/church-accounts#church-church-test"/);
});

test('approved requests distinguish provider invitation outcomes and missing provider status', () => {
  for (const state of ['pending', 'expired', 'revoked']) {
    assert.match(render('approved', state), new RegExp(`Invitation ${state}`));
  }
  const html = render('approved');
  assert.match(html, /Invitation status unavailable/);
  assert.match(html, /Could not check the invitation status/);
  assert.match(html, /Refresh invitation statuses/);
  assert.doesNotMatch(html, /Invitation sent/);
});
