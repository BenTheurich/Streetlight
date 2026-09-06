import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { getChurchAccount } from './church-account.ts';

test('account labels belong to the authenticated organization and ordinary churches default to standard', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-account-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  try {
    migrateDatabase(database);
    seedDatabase(database, { authOrganizationId: 'org-founding' });
    seedDatabase(database, { authOrganizationId: 'org-founding' });
    database.exec(`
      INSERT INTO churches (id, name, auth_organization_id) VALUES ('standard', 'Ordinary Church', 'org-standard');
      INSERT INTO churches (id, name, auth_organization_id, access_kind) VALUES ('sponsored', 'Sponsored Church', 'org-sponsored', 'sponsored');
    `);
    assert.deepEqual(getChurchAccount('org-founding', filename), {
      churchName: 'Temecula Pilot Church',
      accessKind: 'founding',
    });
    assert.deepEqual(getChurchAccount('org-standard', filename), {
      churchName: 'Ordinary Church',
      accessKind: 'standard',
    });
    assert.deepEqual(getChurchAccount('org-sponsored', filename), {
      churchName: 'Sponsored Church',
      accessKind: 'sponsored',
    });
    assert.throws(() => getChurchAccount('org-missing', filename), /not found/);
    assert.throws(() => getChurchAccount('', filename), /not found/);
    assert.throws(
      () => database.exec("UPDATE churches SET access_kind = 'free' WHERE id = 'standard'"),
      /CHECK constraint/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration marks only the established founder church and preserves its account identity', () => {
  const database = openDatabase(':memory:');
  try {
    database.exec(`
      CREATE TABLE churches (id TEXT PRIMARY KEY, name TEXT, auth_organization_id TEXT);
      INSERT INTO churches VALUES ('church-temecula-pilot', 'Renamed Founder Church', 'org-founder');
      INSERT INTO churches VALUES ('another-church', 'Temecula Pilot Church', 'org-another');
    `);
    database.exec(
      readFileSync(new URL('../db/migrations/029_church_access.sql', import.meta.url), 'utf8'),
    );
    const accounts = database
      .prepare('SELECT * FROM churches ORDER BY id')
      .all()
      .map((row: Record<string, unknown>) => ({ ...row }));
    assert.deepEqual(accounts, [
      {
        id: 'another-church',
        name: 'Temecula Pilot Church',
        auth_organization_id: 'org-another',
        access_kind: 'standard',
      },
      {
        id: 'church-temecula-pilot',
        name: 'Renamed Founder Church',
        auth_organization_id: 'org-founder',
        access_kind: 'founding',
      },
    ]);
  } finally {
    database.close();
  }
});
