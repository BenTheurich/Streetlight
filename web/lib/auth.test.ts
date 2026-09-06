import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkOS } from '@workos-inc/node';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import {
  ChurchWorkspaceAccessError,
  loadWorkOSSession,
  requireAdministratorSession,
  requireOrganizationSession,
} from './auth.ts';
import { authenticatedRoute } from './authenticated-route.ts';

const user = {
  id: 'user_test',
  email: 'admin@example.com',
  firstName: 'Ada',
  lastName: 'Admin',
};

test('administrator sessions require a user and a mapped church organization', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-auth-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  } finally {
    database.close();
  }

  try {
    await assert.rejects(
      () => requireAdministratorSession(async () => ({ user: null }), filename),
      /sign in/i,
    );
    await assert.rejects(
      () => requireAdministratorSession(async () => ({ user, organizationId: null }), filename),
      /church workspace/i,
    );
    await assert.rejects(
      () =>
        requireAdministratorSession(
          async () => ({ user, organizationId: 'org_missing' }),
          filename,
        ),
      /church workspace/i,
    );
    assert.deepEqual(
      (
        await requireAdministratorSession(
          async () => ({ user, organizationId: 'org_test_temecula' }),
          filename,
        )
      ).workspace,
      {
        churchId: 'church-temecula-pilot',
        territoryId: 'territory-temecula-pilot',
        timeZone: 'America/Los_Angeles',
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('organization sessions allow an invited church before its territory exists', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-provisional-auth-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database
    .prepare(
      `INSERT INTO churches (id, name, auth_organization_id, time_zone)
      VALUES ('church-new', 'New Church', 'org_new', 'America/Los_Angeles')`,
    )
    .run();
  database.close();
  try {
    const session = await requireOrganizationSession(
      async () => ({ user, organizationId: 'org_new' }),
      filename,
    );
    assert.equal(session.access.churchId, 'church-new');
    assert.equal(session.access.territoryId, null);
    assert.equal(session.access.onboardingCompleted, false);
    await assert.rejects(
      requireAdministratorSession(async () => ({ user, organizationId: 'org_new' }), filename),
      /church workspace/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the production session loader checks current membership on every shared-guard request', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-live-membership-auth-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org_test_temecula' });
  } finally {
    database.close();
  }
  let membership: { organization_id: string; user_id: string; status: string } | null = {
    organization_id: 'org_test_temecula',
    user_id: user.id,
    status: 'active',
  };
  let providerUnavailable = false;
  let providerReads = 0;
  let authorizedCalls = 0;
  const workos = new WorkOS('sk_test_fake', {
    fetchFn: async (input) => {
      providerReads += 1;
      const url = new URL(String(input));
      assert.equal(url.pathname, '/user_management/organization_memberships');
      assert.equal(url.searchParams.get('organization_id'), 'org_test_temecula');
      assert.equal(url.searchParams.get('user_id'), user.id);
      assert.equal(url.searchParams.get('statuses'), 'active');
      assert.equal(url.searchParams.get('limit'), '1');
      if (providerUnavailable)
        return Response.json({ message: 'Private provider failure' }, { status: 503 });
      return Response.json({
        object: 'list',
        data: membership
          ? [
              {
                object: 'organization_membership',
                id: 'membership-test',
                role: { slug: 'member' },
                ...membership,
              },
            ]
          : [],
        list_metadata: { before: null, after: null },
      });
    },
  });
  const validatedSession = () =>
    loadWorkOSSession(async () => ({ user, organizationId: 'org_test_temecula' }), workos);
  const guarded = authenticatedRoute(
    () => {
      authorizedCalls += 1;
      return Response.json({ ok: true });
    },
    validatedSession,
    filename,
  );
  const request = new Request('http://streetlight.local/api/test');
  try {
    assert.equal((await guarded(request)).status, 200);
    assert.equal(authorizedCalls, 1);
    for (const denied of [
      null,
      { organization_id: 'org_test_temecula', user_id: user.id, status: 'inactive' },
      { organization_id: 'org_test_temecula', user_id: user.id, status: 'pending' },
      { organization_id: 'org_foreign', user_id: user.id, status: 'active' },
      { organization_id: 'org_test_temecula', user_id: 'someone-else', status: 'active' },
    ]) {
      membership = denied;
      assert.equal((await guarded(request)).status, 403);
      await assert.rejects(
        requireOrganizationSession(validatedSession, filename),
        ChurchWorkspaceAccessError,
      );
    }
    assert.equal(authorizedCalls, 1);
    providerUnavailable = true;
    const unavailable = await guarded(request);
    assert.equal(unavailable.status, 403);
    assert.doesNotMatch(await unavailable.text(), /private|provider failure/i);
    assert.equal(authorizedCalls, 1);
    assert.ok(providerReads >= 12);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the production session loader preserves signed-out and no-organization states without provider reads', async () => {
  const workos = new WorkOS('sk_test_fake', {
    fetchFn: async () => {
      assert.fail('A session without an organization must not call WorkOS');
    },
  });
  assert.deepEqual(await loadWorkOSSession(async () => ({ user: null }), workos), { user: null });
  assert.deepEqual(await loadWorkOSSession(async () => ({ user, organizationId: null }), workos), {
    user,
    organizationId: null,
  });
});
