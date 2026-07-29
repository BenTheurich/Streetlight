import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import * as database from './database.ts';
import { runInWorkspace } from './workspace-scope.ts';

test('churches store one unique WorkOS organization and their local time zone', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-workspace-schema-'));
  const filename = path.join(directory, 'streetlight.db');
  const connection = openDatabase(filename);
  try {
    migrateDatabase(connection);
    const columns = new Map(
      (
        connection.prepare('PRAGMA table_info(churches)').all() as Array<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>
      ).map((column) => [
        column.name,
        {
          name: column.name,
          notnull: column.notnull,
          dflt_value: column.dflt_value,
        },
      ]),
    );
    assert.deepEqual(columns.get('auth_organization_id'), {
      name: 'auth_organization_id',
      notnull: 0,
      dflt_value: null,
    });
    assert.deepEqual(columns.get('time_zone'), {
      name: 'time_zone',
      notnull: 1,
      dflt_value: "'America/Los_Angeles'",
    });
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database reads use the current church workspace instead of the pilot church', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-workspace-scope-'));
  const filename = path.join(directory, 'streetlight.db');
  const connection = openDatabase(filename);
  try {
    migrateDatabase(connection);
    seedDatabase(connection);
    connection
      .prepare('INSERT INTO churches (id, name) VALUES (?, ?)')
      .run('church-second-test', 'Second Test Church');
    connection
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
        SELECT ?, ?, ?, center_latitude, center_longitude, radius_meters,
          boundary_geojson, ?
        FROM territories
        WHERE id = ?`,
      )
      .run(
        'territory-second-test',
        'church-second-test',
        'Second Territory',
        '1 Second Street, Albany, NY',
        'territory-temecula-pilot',
      );
  } finally {
    connection.close();
  }

  try {
    const workspace = runInWorkspace(
      {
        churchId: 'church-second-test',
        territoryId: 'territory-second-test',
        timeZone: 'America/New_York',
      },
      () => database.getTerritoryWorkspace(filename),
    );

    assert.equal(workspace.churchName, 'Second Test Church');
    assert.equal(workspace.id, 'territory-second-test');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a WorkOS organization resolves to exactly one church workspace', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-organization-scope-'));
  const filename = path.join(directory, 'streetlight.db');
  const connection = openDatabase(filename);
  try {
    migrateDatabase(connection);
    seedDatabase(connection, { authOrganizationId: 'org_test_temecula' });
    connection
      .prepare(
        `INSERT INTO churches (id, name, auth_organization_id, time_zone)
        VALUES (?, ?, ?, ?)`,
      )
      .run('church-second-test', 'Second Test Church', 'org_test_second', 'America/New_York');
    connection
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address)
        SELECT ?, ?, ?, center_latitude, center_longitude, radius_meters,
          boundary_geojson, ?
        FROM territories
        WHERE id = ?`,
      )
      .run(
        'territory-second-test',
        'church-second-test',
        'Second Territory',
        '1 Second Street, Albany, NY',
        'territory-temecula-pilot',
      );
  } finally {
    connection.close();
  }

  try {
    const getWorkspaceForOrganization = (
      database as typeof database & {
        getWorkspaceForOrganization?: (
          organizationId: string,
          filename?: string,
        ) => {
          churchId: string;
          territoryId: string;
          timeZone: string;
        };
      }
    ).getWorkspaceForOrganization;

    assert.deepEqual(getWorkspaceForOrganization?.('org_test_second', filename), {
      churchId: 'church-second-test',
      territoryId: 'territory-second-test',
      timeZone: 'America/New_York',
    });
    assert.throws(() => getWorkspaceForOrganization?.('org_missing', filename), /workspace/i);
    assert.throws(() => database.getTerritoryWorkspace(filename), /workspace scope/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
