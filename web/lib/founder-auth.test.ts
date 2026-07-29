import assert from 'node:assert/strict';
import test from 'node:test';
import { FounderAccessNotFoundError, requireFounderSession } from './founder-auth.ts';

const founder = { id: 'user-founder', email: 'bentheurich@gmail.com' };

test('founder access is restricted to the configured signed-in email', async () => {
  assert.deepEqual(
    await requireFounderSession(
      async () => ({ user: founder, organizationId: 'org-streetlight' }),
      'bentheurich@gmail.com',
    ),
    founder,
  );
  await assert.rejects(
    requireFounderSession(
      async () => ({ user: { id: 'user-admin', email: 'admin@example.com' } }),
      'bentheurich@gmail.com',
    ),
    FounderAccessNotFoundError,
  );
  await assert.rejects(
    requireFounderSession(async () => ({ user: null }), 'bentheurich@gmail.com'),
    FounderAccessNotFoundError,
  );
});
