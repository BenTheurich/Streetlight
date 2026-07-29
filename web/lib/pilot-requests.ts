import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../db/migrate.mjs';

export type PilotRequestStatus = 'pending' | 'declined' | 'provisioning' | 'approved';

export type PilotRequestInput = {
  churchName: string;
  contactName: string;
  email: string;
  location: string;
  outreachProcess: string | null;
};

export type PilotRequest = PilotRequestInput & {
  id: string;
  status: PilotRequestStatus;
  approvedChurchName: string | null;
  inviteEmail: string | null;
  provisionedChurchId: string | null;
  authOrganizationId: string | null;
  authInvitationId: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

type PilotRequestRow = {
  id: string;
  church_name: string;
  contact_name: string;
  email: string;
  location: string;
  outreach_process: string | null;
  status: PilotRequestStatus;
  approved_church_name: string | null;
  invite_email: string | null;
  provisioned_church_id: string | null;
  auth_organization_id: string | null;
  auth_invitation_id: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
};

function databaseFilename(filename?: string): string {
  return (
    filename ??
    process.env.STREETLIGHT_DATABASE_PATH ??
    path.join(process.cwd(), 'data', 'streetlight.db')
  );
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`Enter ${label.toLowerCase()}`);
  const parsed = value.trim().replace(/\s+/g, ' ');
  if (!parsed || parsed.length > maximum) throw new Error(`Enter ${label.toLowerCase()}`);
  return parsed;
}

function email(value: unknown): string {
  const parsed = text(value, 'a valid email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) {
    throw new Error('Enter a valid email');
  }
  return parsed;
}

function normalizedChurchName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

function mapRequest(row: PilotRequestRow): PilotRequest {
  return {
    id: row.id,
    churchName: row.church_name,
    contactName: row.contact_name,
    email: row.email,
    location: row.location,
    outreachProcess: row.outreach_process,
    status: row.status,
    approvedChurchName: row.approved_church_name,
    inviteEmail: row.invite_email,
    provisionedChurchId: row.provisioned_church_id,
    authOrganizationId: row.auth_organization_id,
    authInvitationId: row.auth_invitation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}

function getRequest(database: ReturnType<typeof openDatabase>, id: string): PilotRequest {
  const row = database.prepare('SELECT * FROM pilot_requests WHERE id = ?').get(id) as
    | PilotRequestRow
    | undefined;
  if (!row) throw new Error('Pilot request not found');
  return mapRequest(row);
}

export function parsePilotRequest(value: unknown): PilotRequestInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid request');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(',') !==
    'churchName,contactName,email,location,outreachProcess,website'
  ) {
    throw new Error('Invalid request');
  }
  if (input.website !== '') throw new Error('Invalid request');
  const outreachProcess =
    input.outreachProcess === '' ? null : text(input.outreachProcess, 'Outreach description', 2000);
  return {
    churchName: text(input.churchName, 'Church name', 160),
    contactName: text(input.contactName, 'Your name', 120),
    email: email(input.email),
    location: text(input.location, 'City and state', 160),
    outreachProcess,
  };
}

export function submitPilotRequest(
  input: PilotRequestInput,
  filename?: string,
): { requestId: string; email: string; created: boolean } {
  const database = openDatabase(databaseFilename(filename));
  try {
    const id = `pilot-request-${randomUUID()}`;
    const inserted = database
      .prepare(
        `INSERT INTO pilot_requests
          (id, church_name, normalized_church_name, contact_name, email, normalized_email,
            location, outreach_process)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (normalized_church_name, normalized_email) DO NOTHING`,
      )
      .run(
        id,
        input.churchName,
        normalizedChurchName(input.churchName),
        input.contactName,
        input.email,
        input.email.toLowerCase(),
        input.location,
        input.outreachProcess,
      );
    const row = database
      .prepare(
        `SELECT id, email
        FROM pilot_requests
        WHERE normalized_church_name = ? AND normalized_email = ?`,
      )
      .get(normalizedChurchName(input.churchName), input.email.toLowerCase()) as {
      id: string;
      email: string;
    };
    return { requestId: row.id, email: row.email, created: inserted.changes === 1 };
  } finally {
    database.close();
  }
}

export function listPilotRequests(filename?: string): PilotRequest[] {
  const database = openDatabase(databaseFilename(filename));
  try {
    return (
      database
        .prepare(
          `SELECT *
          FROM pilot_requests
          ORDER BY
            CASE status
              WHEN 'pending' THEN 0
              WHEN 'provisioning' THEN 1
              WHEN 'approved' THEN 2
              ELSE 3
            END,
            created_at DESC,
            id`,
        )
        .all() as PilotRequestRow[]
    ).map(mapRequest);
  } finally {
    database.close();
  }
}

export function declinePilotRequest(id: string, filename?: string): PilotRequest {
  const database = openDatabase(databaseFilename(filename));
  try {
    const current = getRequest(database, id);
    if (current.status === 'approved' || current.status === 'provisioning') {
      throw new Error('Pilot request cannot be declined');
    }
    database
      .prepare(
        `UPDATE pilot_requests
        SET status = 'declined', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(id);
    return getRequest(database, id);
  } finally {
    database.close();
  }
}

export function beginPilotProvisioning(
  id: string,
  corrections: { churchName: string; email: string },
  filename?: string,
): PilotRequest {
  const churchName = text(corrections.churchName, 'Church name', 160);
  const inviteEmail = email(corrections.email);
  const database = openDatabase(databaseFilename(filename));
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = getRequest(database, id);
    const churchId = current.provisionedChurchId ?? `church-${randomUUID()}`;
    if (!current.provisionedChurchId) {
      database
        .prepare(
          `INSERT INTO churches
            (id, name, onboarding_completed_at)
          VALUES (?, ?, NULL)`,
        )
        .run(churchId, churchName);
    }
    database
      .prepare(
        `UPDATE pilot_requests
        SET status = CASE WHEN status = 'approved' THEN status ELSE 'provisioning' END,
          approved_church_name = COALESCE(approved_church_name, ?),
          invite_email = COALESCE(invite_email, ?),
          provisioned_church_id = COALESCE(provisioned_church_id, ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(churchName, inviteEmail, churchId, id);
    const result = getRequest(database, id);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function recordPilotOrganization(
  id: string,
  organizationId: string,
  filename?: string,
): PilotRequest {
  if (!organizationId) throw new Error('WorkOS organization is required');
  const database = openDatabase(databaseFilename(filename));
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = getRequest(database, id);
    if (!current.provisionedChurchId) throw new Error('Pilot request is not provisioning');
    if (current.authOrganizationId && current.authOrganizationId !== organizationId) {
      throw new Error('Pilot request already has another WorkOS organization');
    }
    const churchUpdate = database
      .prepare(
        `UPDATE churches
        SET auth_organization_id = ?
        WHERE id = ? AND (auth_organization_id IS NULL OR auth_organization_id = ?)`,
      )
      .run(organizationId, current.provisionedChurchId, organizationId);
    if (churchUpdate.changes !== 1) {
      throw new Error('WorkOS organization is already assigned');
    }
    database
      .prepare(
        `UPDATE pilot_requests
        SET auth_organization_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(organizationId, id);
    const result = getRequest(database, id);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function recordPilotInvitation(
  id: string,
  invitationId: string,
  filename?: string,
): PilotRequest {
  if (!invitationId) throw new Error('WorkOS invitation is required');
  const database = openDatabase(databaseFilename(filename));
  try {
    const current = getRequest(database, id);
    if (!current.authOrganizationId) throw new Error('WorkOS organization is not ready');
    if (current.authInvitationId && current.authInvitationId !== invitationId) {
      throw new Error('Pilot request already has another WorkOS invitation');
    }
    database
      .prepare(
        `UPDATE pilot_requests
        SET auth_invitation_id = ?, status = 'approved',
          decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .run(invitationId, id);
    return getRequest(database, id);
  } finally {
    database.close();
  }
}
