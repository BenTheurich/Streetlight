import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import {
  beginPilotProvisioning,
  declinePilotRequest,
  listPilotRequests,
  parsePilotRequest,
  recordPilotInvitation,
  recordPilotOrganization,
  submitPilotRequest,
} from './pilot-requests.ts';

function withDatabase(run: (filename: string) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-pilot-requests-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();
  try {
    run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const validRequest = {
  churchName: ' Grace Community Church ',
  contactName: ' Ada Lovelace ',
  email: ' ADMIN@Grace.Example ',
  location: 'Temecula, CA',
  outreachProcess: 'Paper maps and tract bundles.',
  website: '',
};

test('pilot requests validate exact public input and deduplicate normalized church and email', () => {
  assert.deepEqual(parsePilotRequest(validRequest), {
    churchName: 'Grace Community Church',
    contactName: 'Ada Lovelace',
    email: 'admin@grace.example',
    location: 'Temecula, CA',
    outreachProcess: 'Paper maps and tract bundles.',
  });
  assert.throws(() => parsePilotRequest({ ...validRequest, extra: true }), /invalid request/i);
  assert.throws(() => parsePilotRequest({ ...validRequest, email: 'not-email' }), /valid email/i);
  assert.throws(
    () => parsePilotRequest({ ...validRequest, website: 'spam.example' }),
    /invalid request/i,
  );

  withDatabase((filename) => {
    const first = submitPilotRequest(parsePilotRequest(validRequest), filename);
    const duplicate = submitPilotRequest(
      parsePilotRequest({
        ...validRequest,
        churchName: 'grace   community church',
        email: 'admin@GRACE.example',
      }),
      filename,
    );

    assert.equal(duplicate.requestId, first.requestId);
    assert.equal(duplicate.email, 'admin@grace.example');
    assert.equal(listPilotRequests(filename).length, 1);
  });
});

test('pilot request decisions stay resumable and pending requests sort first', () => {
  withDatabase((filename) => {
    const first = submitPilotRequest(parsePilotRequest(validRequest), filename);
    const second = submitPilotRequest(
      parsePilotRequest({
        ...validRequest,
        churchName: 'Second Baptist',
        email: 'second@example.com',
      }),
      filename,
    );

    declinePilotRequest(first.requestId, filename);
    assert.deepEqual(
      listPilotRequests(filename).map(({ id, status }) => ({ id, status })),
      [
        { id: second.requestId, status: 'pending' },
        { id: first.requestId, status: 'declined' },
      ],
    );

    const provisioning = beginPilotProvisioning(
      first.requestId,
      { churchName: 'Grace Community', email: 'pastor@grace.example' },
      filename,
    );
    const repeated = beginPilotProvisioning(
      first.requestId,
      { churchName: 'Ignored retry edit', email: 'ignored@example.com' },
      filename,
    );
    assert.equal(repeated.provisionedChurchId, provisioning.provisionedChurchId);
    assert.equal(repeated.approvedChurchName, 'Grace Community');
    assert.equal(repeated.inviteEmail, 'pastor@grace.example');

    recordPilotOrganization(first.requestId, 'org_grace', filename);
    const approved = recordPilotInvitation(first.requestId, 'invitation_grace', filename);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.authOrganizationId, 'org_grace');
    assert.equal(approved.authInvitationId, 'invitation_grace');

    const database = openDatabase(filename);
    const church = database
      .prepare(
        `SELECT name, auth_organization_id, onboarding_completed_at
        FROM churches WHERE id = ?`,
      )
      .get(approved.provisionedChurchId);
    database.close();
    assert.deepEqual(
      { ...church },
      {
        name: 'Grace Community',
        auth_organization_id: 'org_grace',
        onboarding_completed_at: null,
      },
    );
  });
});
