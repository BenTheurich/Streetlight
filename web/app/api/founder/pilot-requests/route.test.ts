import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import type { FounderChurchAccount } from '../../../../lib/founder-account-types.ts';
import type { FounderIdentityAdapter } from '../../../../lib/founder-church-accounts.ts';
import {
  beginPilotProvisioning,
  parsePilotRequest,
  recordPilotOrganization,
  submitPilotRequest,
} from '../../../../lib/pilot-requests.ts';
import type { WorkOSProvisioningAdapter } from '../../../../lib/workos-provisioning.ts';
import { handleFounderPilotRequests } from './route.ts';

function apiRequest(method: string, body?: unknown): Request {
  return new Request('http://streetlight.local/api/founder/pilot-requests', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const founder: AuthLoader = async () => ({
  user: { id: 'founder', email: 'bentheurich@gmail.com' },
});
const ordinary: AuthLoader = async () => ({
  user: { id: 'ordinary', email: 'admin@example.com' },
});
const adapter: WorkOSProvisioningAdapter = {
  async findOrCreateOrganization(externalId) {
    return { id: `org-${externalId}` };
  },
  async findOrCreateInvitation() {
    return { id: 'invitation-test' };
  },
};

function identityAdapter(
  organizationId: string,
  state: NonNullable<FounderChurchAccount['invitation']>['state'],
): FounderIdentityAdapter {
  return {
    async getInvitation(id) {
      if (state === 'unavailable') throw new Error('Provider unavailable');
      return {
        id,
        organizationId,
        email: 'pastor@example.com',
        state,
        acceptedAt: state === 'accepted' ? '2026-10-05T10:00:00Z' : null,
      };
    },
    async listMemberships() {
      throw new Error('Unexpected membership read');
    },
    async listInvitations() {
      throw new Error('Unexpected invitation list');
    },
    async getUser() {
      throw new Error('Unexpected user read');
    },
  };
}

test('founder request API is hidden from ordinary administrators and supports review actions', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-founder-api-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();
  try {
    const first = submitPilotRequest(
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
    const second = submitPilotRequest(
      parsePilotRequest({
        churchName: 'Second Baptist',
        contactName: 'Grace',
        email: 'grace@example.com',
        location: 'Murrieta, CA',
        outreachProcess: '',
        website: '',
      }),
      filename,
    );

    const hidden = await handleFounderPilotRequests(
      apiRequest('GET'),
      ordinary,
      adapter,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(hidden.status, 404);

    const listed = await handleFounderPilotRequests(
      apiRequest('GET'),
      founder,
      adapter,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).requests.length, 2);

    const declined = await handleFounderPilotRequests(
      apiRequest('PATCH', { id: second.requestId, action: 'decline' }),
      founder,
      adapter,
      filename,
      'bentheurich@gmail.com',
    );
    assert.equal((await declined.json()).request.status, 'declined');

    const approved = await handleFounderPilotRequests(
      apiRequest('PATCH', {
        id: first.requestId,
        action: 'approve',
        churchName: 'Grace Church',
        email: 'pastor@example.com',
      }),
      founder,
      adapter,
      filename,
      'bentheurich@gmail.com',
      identityAdapter(`org-${first.requestId}`, 'pending'),
    );
    assert.deepEqual(
      ((await approved.json()).request as { status: string; approvedChurchName: string }).status,
      'approved',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resumed approval returns the reused invitation state without assuming a new invitation', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'streetlight-founder-resume-'));
  const filename = path.join(directory, 'streetlight.db');
  const database = openDatabase(filename);
  migrateDatabase(database);
  database.close();
  try {
    for (const state of ['pending', 'accepted', 'expired', 'revoked', 'unavailable'] as const) {
      const submitted = submitPilotRequest(
        parsePilotRequest({
          churchName: 'Grace Community',
          contactName: 'Ada',
          email: `${state}@example.com`,
          location: 'Temecula, CA',
          outreachProcess: '',
          website: '',
        }),
        filename,
      );
      const corrections = { churchName: 'Grace Church', email: 'pastor@example.com' };
      const organizationId = `org-${submitted.requestId}`;
      beginPilotProvisioning(submitted.requestId, corrections, filename);
      recordPilotOrganization(submitted.requestId, organizationId, filename);
      const response = await handleFounderPilotRequests(
        apiRequest('PATCH', { id: submitted.requestId, action: 'approve', ...corrections }),
        founder,
        {
          async findOrCreateOrganization() {
            throw new Error('The existing organization must be reused');
          },
          async findOrCreateInvitation() {
            return { id: `existing-${state}` };
          },
        },
        filename,
        'bentheurich@gmail.com',
        identityAdapter(organizationId, state),
      );
      assert.equal(response.status, 200, state);
      const result = await response.json();
      assert.equal(result.request.status, 'approved', state);
      assert.equal(result.invitation?.state, state);
      assert.equal(
        result.invitation.acceptedAt,
        state === 'accepted' ? '2026-10-05T10:00:00Z' : null,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
