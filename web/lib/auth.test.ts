import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { requireAdministratorSession } from './auth.ts';

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
