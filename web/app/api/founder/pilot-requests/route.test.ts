import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../../../../db/migrate.mjs';
import type { AuthLoader } from '../../../../lib/auth.ts';
import { parsePilotRequest, submitPilotRequest } from '../../../../lib/pilot-requests.ts';
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
    );
    assert.deepEqual(
      ((await approved.json()).request as { status: string; approvedChurchName: string }).status,
      'approved',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
