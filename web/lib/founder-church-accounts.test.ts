import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase, openDatabase } from '../db/migrate.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { createInitialTerritory } from './church-workspace-persistence.ts';
import {
  type FounderIdentityAdapter,
  listFounderChurchAccounts,
  readFounderAccountActivities,
} from './founder-church-accounts.ts';
import {
  beginPilotProvisioning,
  recordPilotInvitation,
  recordPilotOrganization,
  submitPilotRequest,
} from './pilot-requests.ts';

const now = new Date('2026-10-05T10:00:00Z');
const provider: FounderIdentityAdapter = {
  async getInvitation(id) {
    return {
      id,
      organizationId: 'org-new',
      email: 'zack@example.test',
      state: 'accepted',
      acceptedAt: '2026-10-04T10:00:00Z',
    };
  },
  async listMemberships(organizationId) {
    return [{ organizationId, userId: 'zack', status: 'active' }];
  },
  async listInvitations() {
    return [];
  },
  async getUser(id) {
    return { id, email: 'zack@example.test', firstName: 'Zack', lastName: 'Test' };
  },
};

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'streetlight-founder-accounts-'));
  const filename = path.join(directory, 'test.db');
  const db = openDatabase(filename);
  migrateDatabase(db);
  const request = submitPilotRequest(
    {
      churchName: 'Test church',
      contactName: 'Zack',
      email: 'zack@example.test',
      location: 'Test city',
      outreachProcess: null,
    },
    filename,
  );
  beginPilotProvisioning(
    request.requestId,
    { churchName: 'Test church', email: 'zack@example.test' },
    filename,
  );
  recordPilotOrganization(request.requestId, 'org-new', filename);
  recordPilotInvitation(request.requestId, 'invitation-new', filename);
  return {
    db,
    filename,
    id: request.requestId,
    dispose() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('an accepted invitation updates the founder view while approval remains approved', async () => {
  const f = fixture();
  try {
    const snapshot = await listFounderChurchAccounts(f.filename, provider, now);
    assert.equal(snapshot.churches[0].setupStatus, 'accepted');
    assert.equal(snapshot.churches[0].invitation?.acceptedAt, '2026-10-04T10:00:00Z');
    assert.equal(snapshot.churches[0].administrators[0].userId, 'zack');
    assert.equal(f.db.prepare('SELECT status FROM pilot_requests').get()?.status, 'approved');
    assert.equal(snapshot.churches[0].territory, null);
  } finally {
    f.dispose();
  }
});

test('provider failure reports unavailable instead of pending and preserves local data', async () => {
  const f = fixture();
  try {
    createInitialTerritory(
      'org-new',
      {
        churchName: 'Test church',
        timeZone: 'Europe/Berlin',
        formattedAddress: 'Test address',
        center: [11.5, 48.1],
      },
      f.filename,
    );
    f.db
      .prepare('UPDATE churches SET onboarding_completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(f.id);
    const unavailable = {
      ...provider,
      async getInvitation() {
        throw new Error('SECRET provider details');
      },
    };
    const {
      churches: [church],
    } = await listFounderChurchAccounts(f.filename, unavailable, now);
    assert.equal(church.setupStatus, 'ready');
    assert.equal(church.invitation?.state, 'unavailable');
    assert.equal(church.identityAvailable, false);
    assert.equal(church.territory?.address, 'Test address');
    assert.equal(JSON.stringify(church).includes('SECRET'), false);
  } finally {
    f.dispose();
  }
});

test('issue recovery is operation and target specific, pagination and actor history stay church scoped', async () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO churches (id, name) VALUES ('other', 'Other church')").run();
    const insert = f.db.prepare(
      `INSERT INTO account_activity (church_id,user_id,actor_name,actor_email,action,outcome,target_id,recorded_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    );
    insert.run(f.id, 'zack', 'Zack', 'zack@example.test', 'pdf_preparation', 'failed', 'batch-a');
    insert.run(
      f.id,
      'zack',
      'Zack',
      'zack@example.test',
      'pdf_preparation',
      'succeeded',
      'batch-b',
    );
    insert.run(
      'other',
      'other-user',
      'Other',
      'other@example.test',
      'onboarding',
      'succeeded',
      null,
    );
    let church = (await listFounderChurchAccounts(f.filename, provider, now)).churches.find(
      (c) => c.id === f.id,
    );
    assert.ok(church);
    assert.equal(church.issues.filter((i) => i.resolvedAt === null).length, 1);
    assert.equal(church.activityTotal, 2);
    assert.equal(church.administrators[0].lastActivityAt, church.lastActivity?.recordedAt);
    insert.run(
      f.id,
      'zack',
      'Zack',
      'zack@example.test',
      'pdf_preparation',
      'succeeded',
      'batch-a',
    );
    church = (await listFounderChurchAccounts(f.filename, provider, now)).churches.find(
      (c) => c.id === f.id,
    );
    assert.ok(church);
    assert.equal(church.issues.filter((i) => i.resolvedAt === null).length, 0);
    assert.ok(church.issues[0].resolvedAt);
    const page = readFounderAccountActivities(f.id, church.activities[0].id, f.filename);
    assert.equal(page.activities.length, 2);
    assert.equal(
      page.activities.every((a) => a.churchId === f.id),
      true,
    );
    assert.throws(
      () => readFounderAccountActivities('missing', undefined, f.filename),
      /not found/i,
    );
  } finally {
    f.dispose();
  }
});

test('failed replacement imports keep the saved territory and recover only after a successful import', async () => {
  const f = fixture();
  try {
    const { territoryId } = createInitialTerritory(
      'org-new',
      {
        churchName: 'Test church',
        timeZone: 'Europe/Berlin',
        formattedAddress: 'Saved address',
        center: [11.5, 48.1],
      },
      f.filename,
    );
    f.db
      .prepare('UPDATE churches SET onboarding_completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(f.id);
    const draft = JSON.stringify({
      originAddress: 'Attempted address',
      center: [11.6, 48.1],
      radiusMiles: 3,
      boundaryShape: 'square',
      activatedSegmentIds: [],
      excludedSegmentIds: [],
    });
    f.db
      .prepare(
        `INSERT INTO territory_import_jobs (id,church_id,territory_id,draft_json,draft_fingerprint,status,stage,error,completed_at) VALUES ('failed',?,?,?,'draft','failed','matching','Safe failure',CURRENT_TIMESTAMP)`,
      )
      .run(f.id, territoryId, draft);
    let church = (await listFounderChurchAccounts(f.filename, provider, now)).churches[0];
    assert.equal(church.territory?.distanceMiles, 1);
    assert.equal(church.importJob?.attemptedDistanceMiles, 3);
    assert.equal(church.importJob?.attemptedAddress, 'Attempted address');
    assert.equal(church.issues.filter((i) => !i.resolvedAt).length, 1);
    f.db
      .prepare(
        `INSERT INTO territory_import_jobs (id,church_id,territory_id,draft_json,draft_fingerprint,status,stage,completed_at) VALUES ('recovered',?,?,?,'retry','succeeded','saving',CURRENT_TIMESTAMP)`,
      )
      .run(f.id, territoryId, draft);
    church = (await listFounderChurchAccounts(f.filename, provider, now)).churches[0];
    assert.ok(church.issues.find((i) => i.id === 'import-failed')?.resolvedAt);
  } finally {
    f.dispose();
  }
});

test('churches without pilot requests remain visible; packet totals reflect undo and cancellation', async () => {
  const f = fixture();
  try {
    seedDatabase(f.db, { authOrganizationId: 'org-founder' });
    f.db
      .prepare(
        "INSERT INTO batches (id,church_id,name,status,finalized_at) VALUES ('batch',?,'Outreach','finalized',CURRENT_TIMESTAMP)",
      )
      .run(f.id);
    const packet = f.db.prepare(
      `INSERT INTO packets (id,church_id,batch_id,packet_code,start_address,estimated_homes,status,sequence_number) VALUES (?,?,'batch',?,'Test',10,?,?)`,
    );
    packet.run('a', f.id, 'A', 'completed', 0);
    packet.run('b', f.id, 'B', 'cancelled', 1);
    packet.run('c', f.id, 'C', 'active', 2);
    let snapshot = await listFounderChurchAccounts(f.filename, provider, now);
    assert.equal(snapshot.churches.length, 2);
    let selected = snapshot.churches.find((c) => c.id === f.id);
    assert.ok(selected);
    let counts = selected.packets;
    assert.deepEqual(
      [counts.batches, counts.total, counts.active, counts.completed, counts.cancelled],
      [1, 3, 1, 1, 1],
    );
    f.db.prepare("UPDATE packets SET status='active' WHERE id='a'").run();
    snapshot = await listFounderChurchAccounts(f.filename, provider, now);
    selected = snapshot.churches.find((c) => c.id === f.id);
    assert.ok(selected);
    counts = selected.packets;
    assert.deepEqual(
      [counts.total, counts.active, counts.completed, counts.cancelled],
      [3, 2, 0, 1],
    );
  } finally {
    f.dispose();
  }
});

test('estimated homes count each effective covered segment once and apply correction and undo', async () => {
  const f = fixture();
  try {
    const { territoryId } = createInitialTerritory(
      'org-new',
      {
        churchName: 'Test church',
        timeZone: 'Europe/Berlin',
        formattedAddress: 'Test address',
        center: [11.5, 48.1],
      },
      f.filename,
    );
    f.db
      .prepare(
        `INSERT INTO street_segments(id,church_id,territory_id,street_name,geometry_geojson,estimated_homes,import_segment_id,road_group_id) VALUES ('covered',?,?,'Test street','{"type":"LineString","coordinates":[[11.5,48.1],[11.501,48.1]]}',12,'covered','test-road')`,
      )
      .run(f.id, territoryId);
    const complete = f.db.prepare(
      `INSERT INTO coverage_events(id,church_id,street_segment_id,covered_on,kind) VALUES (?,?,'covered','2026-09-01','completed')`,
    );
    complete.run('first', f.id);
    complete.run('repeat', f.id);
    const read = async () =>
      (await listFounderChurchAccounts(f.filename, provider, now)).churches[0].packets
        .estimatedHomesReached;
    assert.equal(await read(), 12);
    f.db
      .prepare(
        `INSERT INTO coverage_events(id,church_id,street_segment_id,covered_on,kind,corrects_event_id) VALUES ('correct-date',?,'covered','2026-09-02','correction','first')`,
      )
      .run(f.id);
    assert.equal(await read(), 12);
    f.db
      .prepare(
        `INSERT INTO coverage_events(id,church_id,street_segment_id,covered_on,kind,corrects_event_id,is_void) VALUES ('undo-first',?,'covered','2026-09-02','correction','first',1)`,
      )
      .run(f.id);
    assert.equal(await read(), 12);
    f.db
      .prepare(
        `INSERT INTO coverage_events(id,church_id,street_segment_id,covered_on,kind,corrects_event_id,is_void) VALUES ('undo-repeat',?,'covered','2026-09-01','correction','repeat',1)`,
      )
      .run(f.id);
    assert.equal(await read(), 0);
  } finally {
    f.dispose();
  }
});
