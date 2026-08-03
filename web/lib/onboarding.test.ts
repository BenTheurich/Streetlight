import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { getOrganizationAccess, saveTerritoryDraft } from './database.ts';
import { onboardChurch, parseOnboardingInput } from './onboarding.ts';
import { runInWorkspace } from './workspace-scope.ts';

test('onboarding validates exact church input and creates an empty one-mile circle', async () => {
  assert.deepEqual(
    parseOnboardingInput({
      churchName: ' Grace Church ',
      address: ' 1 Main Street ',
      timeZone: 'America/Los_Angeles',
    }),
    {
      churchName: 'Grace Church',
      address: '1 Main Street',
      timeZone: 'America/Los_Angeles',
    },
  );
  assert.throws(
    () =>
      parseOnboardingInput({
        churchName: 'Grace',
        address: '1 Main',
        timeZone: 'Not/A_Timezone',
      }),
    /time zone/i,
  );
  assert.throws(
    () =>
      parseOnboardingInput({
        churchName: 'Grace',
        address: '1 Main',
        timeZone: 'America/Los_Angeles',
        extra: true,
      }),
    /invalid onboarding/i,
  );

  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-onboarding-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database
    .prepare(
      `INSERT INTO churches (id, name, auth_organization_id)
      VALUES ('church-new', 'Provisional', 'org_new')`,
    )
    .run();
  database.close();
  try {
    const result = await onboardChurch(
      'org_new',
      {
        churchName: 'Grace Church',
        address: '1 Main Street',
        timeZone: 'America/Los_Angeles',
      },
      async () => ({
        formattedAddress: '1 Main St, Temecula, CA 92590, USA',
        center: [-117.15, 33.5],
      }),
      filename,
    );
    assert.equal(result.radiusMiles, 1);
    assert.equal(result.boundaryShape, 'circle');

    const access = getOrganizationAccess('org_new', filename);
    assert.equal(access.territoryId, result.territoryId);
    assert.equal(access.onboardingCompleted, false);

    const check = openDatabase(filename);
    assert.deepEqual(
      {
        ...check
          .prepare(
            `SELECT c.name, c.time_zone, c.onboarding_completed_at, t.origin_address,
              t.radius_meters, t.boundary_shape,
              (SELECT COUNT(*) FROM street_segments WHERE territory_id = t.id) AS segments
            FROM churches c JOIN territories t ON t.church_id = c.id
            WHERE c.id = 'church-new'`,
          )
          .get(),
      },
      {
        name: 'Grace Church',
        time_zone: 'America/Los_Angeles',
        onboarding_completed_at: null,
        origin_address: '1 Main St, Temecula, CA 92590, USA',
        radius_meters: 1609.344,
        boundary_shape: 'circle',
        segments: 0,
      },
    );
    check.close();

    runInWorkspace(
      {
        churchId: 'church-new',
        territoryId: result.territoryId,
        timeZone: 'America/Los_Angeles',
      },
      () =>
        saveTerritoryDraft(
          {
            originAddress: result.formattedAddress,
            center: result.center,
            radiusMiles: 1,
            boundaryShape: 'circle',
            activatedSegmentIds: [],
            excludedSegmentIds: [],
          },
          { filename },
        ),
    );
    assert.equal(getOrganizationAccess('org_new', filename).onboardingCompleted, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
