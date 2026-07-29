import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { parsePilotRequest, submitPilotRequest } from './pilot-requests.ts';
import { provisionPilotRequest, type WorkOSProvisioningAdapter } from './workos-provisioning.ts';

test('pilot provisioning resumes after an external failure without creating duplicates', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-provisioning-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();

  let organizations = 0;
  let invitationAttempts = 0;
  const adapter: WorkOSProvisioningAdapter = {
    async findOrCreateOrganization(externalId) {
      organizations += 1;
      return { id: `org-${externalId}` };
    },
    async findOrCreateInvitation() {
      invitationAttempts += 1;
      if (invitationAttempts === 1) throw new Error('WorkOS unavailable');
      return { id: 'invitation-grace' };
    },
  };

  try {
    const submitted = submitPilotRequest(
      parsePilotRequest({
        churchName: 'Grace Community',
        contactName: 'Ada',
        email: 'ada@example.com',
        location: 'Temecula, CA',
        outreachProcess: '',
        website: '',
      }),
      filename,
    );
    await assert.rejects(
      provisionPilotRequest(
        submitted.requestId,
        { churchName: 'Grace Church', email: 'pastor@example.com' },
        adapter,
        filename,
      ),
      /unavailable/,
    );

    const approved = await provisionPilotRequest(
      submitted.requestId,
      { churchName: 'Ignored retry', email: 'ignored@example.com' },
      adapter,
      filename,
    );
    const repeated = await provisionPilotRequest(
      submitted.requestId,
      { churchName: 'Ignored again', email: 'ignored-again@example.com' },
      adapter,
      filename,
    );

    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedChurchName, 'Grace Church');
    assert.equal(approved.inviteEmail, 'pastor@example.com');
    assert.equal(repeated.authInvitationId, 'invitation-grace');
    assert.equal(organizations, 1);
    assert.equal(invitationAttempts, 2);

    const check = openDatabase(filename);
    assert.equal(
      (check.prepare('SELECT COUNT(*) AS count FROM churches').get() as { count: number }).count,
      1,
    );
    check.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
