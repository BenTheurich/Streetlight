import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOS } from '@workos-inc/node';
import {
  AdministratorAccessError,
  createWorkOSAdministratorsAdapter,
  listChurchAdministrators,
  mutateChurchAdministrator,
  parseAdministratorAction,
  type WorkOSAdministratorsAdapter,
} from './church-administrators.ts';

function fixture() {
  const memberships: Awaited<ReturnType<WorkOSAdministratorsAdapter['listMemberships']>> = [
    { id: 'member-a', userId: 'alice', organizationId: 'org-a', status: 'active' },
    { id: 'member-b', userId: 'bob', organizationId: 'org-a', status: 'active' },
    { id: 'member-c', userId: 'carol', organizationId: 'org-b', status: 'active' },
    { id: 'member-inactive', userId: 'inactive', organizationId: 'org-a', status: 'inactive' },
  ];
  const invitations: Awaited<ReturnType<WorkOSAdministratorsAdapter['listInvitations']>> = [
    { id: 'invite-a', organizationId: 'org-a', email: 'pending@example.com', state: 'pending' },
    { id: 'invite-b', organizationId: 'org-b', email: 'foreign@example.com', state: 'pending' },
    { id: 'invite-accepted', organizationId: 'org-a', email: 'old@example.com', state: 'accepted' },
    {
      id: 'invite-expired',
      organizationId: 'org-a',
      email: 'expired@example.com',
      state: 'expired',
    },
    {
      id: 'invite-revoked',
      organizationId: 'org-a',
      email: 'revoked@example.com',
      state: 'revoked',
    },
  ];
  const calls: Array<{ action: string; id: string; email?: string }> = [];
  const adapter: WorkOSAdministratorsAdapter = {
    async listMemberships(organizationId) {
      calls.push({ action: 'members', id: organizationId });
      return memberships;
    },
    async listInvitations(organizationId) {
      calls.push({ action: 'invitations', id: organizationId });
      return invitations;
    },
    async getUser(id) {
      calls.push({ action: 'user', id });
      return {
        id,
        email: `${id}@example.com`,
        firstName: id === 'alice' ? 'Alice' : null,
        lastName: id === 'alice' ? 'Jones' : null,
      };
    },
    async sendInvitation(organizationId, email) {
      calls.push({ action: 'send', id: organizationId, email });
      invitations.push({
        id: `invite-${invitations.length}`,
        organizationId,
        email,
        state: 'pending',
      });
    },
    async revokeInvitation(id) {
      calls.push({ action: 'revoke', id });
      const item = invitations.find((invitation) => invitation.id === id);
      if (item) item.state = 'revoked';
    },
    async removeMembership(id) {
      calls.push({ action: 'remove', id });
      const item = memberships.find((membership) => membership.id === id);
      if (item) item.status = 'inactive';
    },
  };
  return { adapter, calls, memberships, invitations };
}

test('roster lists only active church members and pending church invitations', async () => {
  const { adapter, calls } = fixture();
  assert.deepEqual(await listChurchAdministrators('org-a', 'alice', adapter), {
    administrators: [
      {
        id: 'member-a',
        userId: 'alice',
        name: 'Alice Jones',
        email: 'alice@example.com',
        isCurrentUser: true,
      },
      { id: 'member-b', userId: 'bob', name: '', email: 'bob@example.com', isCurrentUser: false },
    ],
    invitations: [{ id: 'invite-a', email: 'pending@example.com' }],
  });
  assert.deepEqual(
    calls
      .filter((call) => call.action === 'user')
      .map((call) => call.id)
      .sort(),
    ['alice', 'bob'],
  );
});

test('inactive and foreign actors cannot read roster details or make mutations', async () => {
  for (const userId of ['inactive', 'carol', 'missing']) {
    const { adapter, calls } = fixture();
    await assert.rejects(
      listChurchAdministrators('org-a', userId, adapter),
      AdministratorAccessError,
    );
    await assert.rejects(
      mutateChurchAdministrator(
        'org-a',
        userId,
        { action: 'invite', email: 'new@example.com' },
        adapter,
      ),
      AdministratorAccessError,
    );
    assert.ok(calls.every((call) => call.action === 'members'));
  }
});

test('membership and invitation mutations reject foreign IDs, self-removal, and non-pending invitations', async () => {
  const { adapter, calls } = fixture();
  for (const action of [
    { action: 'remove', id: 'member-c' },
    { action: 'remove', id: 'member-a' },
    { action: 'revoke', id: 'invite-b' },
    { action: 'revoke', id: 'invite-accepted' },
    { action: 'revoke', id: 'invite-expired' },
  ] as const) {
    await assert.rejects(
      mutateChurchAdministrator('org-a', 'alice', action, adapter),
      /this church|yourself/,
    );
  }
  assert.equal(calls.filter((call) => ['remove', 'revoke'].includes(call.action)).length, 0);
  await mutateChurchAdministrator('org-a', 'alice', { action: 'revoke', id: 'invite-a' }, adapter);
  await mutateChurchAdministrator('org-a', 'alice', { action: 'remove', id: 'member-b' }, adapter);
  assert.deepEqual(
    calls.filter((call) => ['remove', 'revoke'].includes(call.action)),
    [
      { action: 'revoke', id: 'invite-a' },
      { action: 'remove', id: 'member-b' },
    ],
  );
});

test('invitations normalize email, coalesce concurrent requests, and can be sent separately by each church', async () => {
  const { adapter, calls } = fixture();
  const invite = { action: 'invite', email: '  New@Example.com  ' } as const;
  await Promise.all([
    mutateChurchAdministrator('org-a', 'alice', invite, adapter),
    mutateChurchAdministrator('org-a', 'bob', invite, adapter),
  ]);
  await mutateChurchAdministrator('org-a', 'alice', invite, adapter);
  await mutateChurchAdministrator(
    'org-a',
    'alice',
    { action: 'invite', email: 'BOB@example.com' },
    adapter,
  );
  await mutateChurchAdministrator(
    'org-a',
    'alice',
    { action: 'invite', email: 'pending@example.com' },
    adapter,
  );
  await mutateChurchAdministrator('org-b', 'carol', invite, adapter);
  assert.deepEqual(
    calls.filter((call) => call.action === 'send'),
    [
      { action: 'send', id: 'org-a', email: 'new@example.com' },
      { action: 'send', id: 'org-b', email: 'new@example.com' },
    ],
  );
});

test('invitation retry recovers a lost response and permits a new invitation after revocation', async () => {
  const { adapter, invitations, calls } = fixture();
  const send = adapter.sendInvitation;
  adapter.sendInvitation = async (...args) => {
    await send(...args);
    throw new Error('Provider lost response');
  };
  const action = { action: 'invite', email: 'new@example.com' } as const;
  assert.deepEqual(await mutateChurchAdministrator('org-a', 'alice', action, adapter), {
    message: 'Invitation sent.',
  });
  const invitation = invitations.find((item) => item.email === action.email);
  assert.ok(invitation);
  await mutateChurchAdministrator(
    'org-a',
    'alice',
    { action: 'revoke', id: invitation.id },
    adapter,
  );
  await mutateChurchAdministrator('org-a', 'alice', action, adapter);
  assert.equal(calls.filter((call) => call.action === 'send').length, 2);
});

test('an unsuccessful provider send releases the invitation lock for retry', async () => {
  const { adapter, calls } = fixture();
  const send = adapter.sendInvitation;
  adapter.sendInvitation = async () => {
    throw new Error('Provider unavailable');
  };
  const action = { action: 'invite', email: 'new@example.com' } as const;
  await assert.rejects(mutateChurchAdministrator('org-a', 'alice', action, adapter), /unavailable/);
  adapter.sendInvitation = send;
  await mutateChurchAdministrator('org-a', 'alice', action, adapter);
  assert.equal(calls.filter((call) => call.action === 'send').length, 1);
});

test('actions accept only their fields and a valid bounded email', () => {
  for (const value of [
    null,
    [],
    {},
    { action: 'invite', email: 'missing-at' },
    { action: 'invite', email: `${'x'.repeat(254)}@example.com` },
    { action: 'invite', email: 'valid@example.com', organizationId: 'foreign' },
    { action: 'remove', id: '' },
    { action: 'remove', id: 'member', userId: 'foreign' },
  ]) {
    assert.throws(() => parseAdministratorAction(value));
  }
});

test('production WorkOS adapter follows every membership and invitation page with church filters', async () => {
  const requests: URL[] = [];
  const workos = new WorkOS('sk_test_fake', {
    fetchFn: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.searchParams.get('organization_id'), 'org-a');
      const second = url.searchParams.has('after');
      const membership = url.pathname.endsWith('organization_memberships');
      assert.ok(membership || url.pathname.endsWith('invitations'));
      if (membership) assert.equal(url.searchParams.get('statuses'), 'active');
      return Response.json({
        object: 'list',
        data: membership
          ? [
              {
                object: 'organization_membership',
                id: second ? 'member-b' : 'member-a',
                organization_id: 'org-a',
                user_id: second ? 'bob' : 'alice',
                status: 'active',
                role: { slug: 'member' },
              },
            ]
          : [
              {
                object: 'invitation',
                id: second ? 'invite-b' : 'invite-a',
                organization_id: 'org-a',
                email: second ? 'b@example.com' : 'a@example.com',
                state: 'pending',
              },
            ],
        list_metadata: { before: null, after: second ? null : 'next-page' },
      });
    },
  });
  const adapter = await createWorkOSAdministratorsAdapter(workos);
  assert.deepEqual(
    (await adapter.listMemberships('org-a')).map((item) => item.id),
    ['member-a', 'member-b'],
  );
  assert.deepEqual(
    (await adapter.listInvitations('org-a')).map((item) => item.id),
    ['invite-a', 'invite-b'],
  );
  assert.equal(requests.filter((url) => url.searchParams.get('after') === 'next-page').length, 2);
});
