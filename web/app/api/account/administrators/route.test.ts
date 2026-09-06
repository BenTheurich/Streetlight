import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import type { WorkOSAdministratorsAdapter } from '../../../../lib/church-administrators.ts';
import { handleChurchAdministrators } from './route.ts';

function apiRequest(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://streetlight.local/api/account/administrators', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('administrator API authenticates, rejects forged scopes and IDs, and only uses the session church', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-administrators-api-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.exec(
    "INSERT INTO churches (id, name, auth_organization_id) VALUES ('church-a', 'Church A', 'org-a'), ('church-b', 'Church B', 'org-b')",
  );
  database.close();
  const calls: string[] = [];
  const loadSession: AuthLoader = async () => ({
    user: { id: 'alice', email: 'alice@example.com' },
    organizationId: 'org-a',
  });
  const adapter: WorkOSAdministratorsAdapter = {
    async listMemberships(org) {
      calls.push(`members:${org}`);
      return [
        { id: 'member-a', userId: 'alice', organizationId: 'org-a', status: 'active' },
        { id: 'member-b', userId: 'bob', organizationId: 'org-b', status: 'active' },
      ];
    },
    async listInvitations(org) {
      calls.push(`invitations:${org}`);
      return [
        { id: 'invite-b', email: 'bob@example.com', organizationId: 'org-b', state: 'pending' },
      ];
    },
    async getUser(id) {
      return { id, email: `${id}@example.com`, firstName: null, lastName: null };
    },
    async sendInvitation(org, email) {
      calls.push(`send:${org}:${email}`);
    },
    async revokeInvitation(id) {
      calls.push(`revoke:${id}`);
    },
    async removeMembership(id) {
      calls.push(`remove:${id}`);
    },
  };
  const request = (method: string, body?: unknown, headers?: Record<string, string>) =>
    handleChurchAdministrators(apiRequest(method, body, headers), loadSession, adapter, filename);
  try {
    const signedOut = await handleChurchAdministrators(
      apiRequest('GET'),
      async () => ({ user: null }),
      adapter,
      filename,
    );
    assert.equal(signedOut.status, 401);
    assert.equal(calls.length, 0);
    for (const organizationId of [null, 'org-missing', 'org-b']) {
      const response = await handleChurchAdministrators(
        apiRequest('GET'),
        async () => ({ ...(await loadSession()), organizationId }),
        adapter,
        filename,
      );
      assert.equal(response.status, 403);
    }
    calls.length = 0;
    const listing = await request('GET');
    assert.equal(listing.status, 200);
    assert.equal(listing.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await listing.json(), {
      administrators: [
        {
          id: 'member-a',
          userId: 'alice',
          name: '',
          email: 'alice@example.com',
          isCurrentUser: true,
        },
      ],
      invitations: [],
    });
    for (const body of [
      { action: 'invite', email: 'new@example.com', organizationId: 'org-b' },
      { action: 'remove', id: 'member-b' },
      { action: 'remove', id: 'member-a' },
      { action: 'revoke', id: 'invite-b' },
    ])
      assert.equal((await request('PATCH', body)).status, 400);
    assert.ok(calls.every((call) => call === 'members:org-a' || call === 'invitations:org-a'));
    assert.equal(
      (
        await request(
          'PATCH',
          { action: 'invite', email: 'new@example.com' },
          { origin: 'https://foreign.example' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          'PATCH',
          { action: 'invite', email: 'new@example.com' },
          { 'sec-fetch-site': 'cross-site' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          'PATCH',
          { action: 'invite', email: 'new@example.com' },
          { 'content-type': 'text/plain' },
        )
      ).status,
      415,
    );
    const invited = await request(
      'PATCH',
      { action: 'invite', email: 'NEW@example.com' },
      { origin: 'http://streetlight.local' },
    );
    assert.equal(invited.status, 200);
    assert.deepEqual(await invited.json(), { message: 'Invitation sent.' });
    assert.equal(calls.at(-1), 'send:org-a:new@example.com');
    adapter.listMemberships = async () => {
      throw new Error('Provider secret and private data');
    };
    const unavailable = await request('GET');
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(await unavailable.text(), /secret|private data/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
