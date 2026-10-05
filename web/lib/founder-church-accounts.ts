import type { DatabaseSync } from 'node:sqlite';
import type { Invitation, OrganizationMembership, User, WorkOS } from '@workos-inc/node';
import { calendarDateInTimeZone } from './coverage.ts';
import { getCoverageWorkspace } from './coverage-persistence.ts';
import {
  type AccountActivity,
  type AccountIssue,
  accountActionLabels,
  type FounderAccountsSnapshot,
  type FounderChurchAccount,
} from './founder-account-types.ts';
import type { PilotRequest } from './pilot-requests.ts';
import { applyMvpCapabilities } from './product-capabilities.ts';
import { withWorkspaceDatabase } from './sqlite-persistence.ts';
import type { TerritoryDraftInput } from './territory-draft.ts';
import { territoryBoundary } from './territory-geometry.ts';
import { getTerritoryWorkspace } from './territory-persistence.ts';
import { runInWorkspace } from './workspace-scope.ts';

export type FounderIdentityAdapter = {
  getInvitation(
    id: string,
  ): Promise<Pick<Invitation, 'id' | 'organizationId' | 'email' | 'state' | 'acceptedAt'>>;
  listMemberships(
    organizationId: string,
  ): Promise<Array<Pick<OrganizationMembership, 'organizationId' | 'userId' | 'status'>>>;
  listInvitations(
    organizationId: string,
  ): Promise<Array<Pick<Invitation, 'id' | 'organizationId' | 'email' | 'state'>>>;
  getUser(id: string): Promise<Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>>;
};

export async function createFounderIdentityAdapter(
  client?: WorkOS,
): Promise<FounderIdentityAdapter> {
  const { WorkOS } = await import('@workos-inc/node');
  const { userManagement } = client ?? new WorkOS(process.env.WORKOS_API_KEY);
  return {
    getInvitation: (id) => userManagement.getInvitation(id),
    listMemberships: async (organizationId) =>
      (
        await userManagement.listOrganizationMemberships({ organizationId, statuses: ['active'] })
      ).autoPagination(),
    listInvitations: async (organizationId) =>
      (await userManagement.listInvitations({ organizationId })).autoPagination(),
    getUser: (id) => userManagement.getUser(id),
  };
}

type ChurchRow = {
  id: string;
  name: string;
  time_zone: string;
  access_kind: string;
  created_at: string;
  onboarding_completed_at: string | null;
  auth_organization_id: string | null;
  auth_invitation_id: string | null;
  invite_email: string | null;
  contact_name: string | null;
  email: string | null;
  location: string | null;
};

type ActivityRow = {
  id: number;
  church_id: string;
  user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: AccountActivity['action'];
  outcome: AccountActivity['outcome'];
  target_id: string | null;
  recorded_at: string;
};

function mapActivity(row: ActivityRow): AccountActivity {
  return {
    id: row.id,
    churchId: row.church_id,
    userId: row.user_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    outcome: row.outcome,
    targetId: row.target_id,
    recordedAt: row.recorded_at,
  };
}

const ACTIVITY_PAGE_SIZE = 50;

function activityPage(database: DatabaseSync, churchId: string, before?: number) {
  const rows = database
    .prepare(
      `SELECT * FROM account_activity WHERE church_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(churchId, before ?? null, before ?? null, ACTIVITY_PAGE_SIZE + 1) as ActivityRow[];
  return {
    activities: rows.slice(0, ACTIVITY_PAGE_SIZE).map(mapActivity),
    hasMore: rows.length > ACTIVITY_PAGE_SIZE,
  };
}

export function readFounderAccountActivities(churchId: string, before?: number, filename?: string) {
  return withWorkspaceDatabase(filename, (database) => {
    if (!database.prepare('SELECT 1 FROM churches WHERE id=?').get(churchId))
      throw new Error('Church not found');
    return activityPage(database, churchId, before);
  });
}

export async function readPilotInvitationStatuses(
  requests: PilotRequest[],
  adapter?: FounderIdentityAdapter,
) {
  const approved = requests.filter((r) => r.status === 'approved');
  if (approved.length === 0) return {};
  let workos = adapter;
  try {
    workos ??= await createFounderIdentityAdapter();
  } catch {
    /* Report unavailable below. */
  }
  const entries = await Promise.all(
    approved.map(async (r) => {
      const email = r.inviteEmail ?? r.email;
      let invitation: NonNullable<FounderChurchAccount['invitation']> = {
        state: 'unavailable',
        email,
        acceptedAt: null,
      };
      try {
        if (!workos || !r.authInvitationId || !r.authOrganizationId)
          throw new Error('Invitation not provisioned');
        const value = await workos.getInvitation(r.authInvitationId);
        if (value.id !== r.authInvitationId || value.organizationId !== r.authOrganizationId)
          throw new Error('Invitation does not belong to church');
        invitation = { state: value.state, email: value.email, acceptedAt: value.acceptedAt };
      } catch {
        /* Unknown is truthful when the identity provider is unavailable. */
      }
      return [r.id, invitation] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function identity(church: ChurchRow, workos?: FounderIdentityAdapter) {
  const empty = {
    identityAvailable: false,
    administrators: [] as FounderChurchAccount['administrators'],
    pendingInvitations: [] as FounderChurchAccount['pendingInvitations'],
    invitation: church.auth_invitation_id
      ? {
          state: 'unavailable' as const,
          email: church.invite_email ?? church.email ?? '',
          acceptedAt: null,
        }
      : null,
  };
  if (!church.auth_organization_id || !workos) return empty;
  try {
    const organizationId = church.auth_organization_id;
    const [memberships, invitations, invitation] = await Promise.all([
      workos.listMemberships(organizationId),
      workos.listInvitations(organizationId),
      church.auth_invitation_id ? workos.getInvitation(church.auth_invitation_id) : null,
    ]);
    if (
      invitation &&
      (invitation.id !== church.auth_invitation_id || invitation.organizationId !== organizationId)
    )
      throw new Error('Invitation does not belong to church');
    const users = await Promise.all(
      memberships
        .filter((m) => m.organizationId === organizationId && m.status === 'active')
        .map((m) => workos.getUser(m.userId)),
    );
    return {
      identityAvailable: true,
      administrators: users
        .map((user) => ({
          userId: user.id,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
          email: user.email,
          lastActivityAt: null as string | null,
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
      pendingInvitations: invitations
        .filter((i) => i.organizationId === organizationId && i.state === 'pending')
        .map(({ id, email }) => ({ id, email }))
        .sort((a, b) => a.email.localeCompare(b.email)),
      invitation: invitation
        ? { state: invitation.state, email: invitation.email, acceptedAt: invitation.acceptedAt }
        : null,
    };
  } catch {
    return empty;
  }
}

function recordedIssues(database: DatabaseSync, churchId: string): AccountIssue[] {
  const rows = database
    .prepare(`SELECT a.*, (SELECT s.recorded_at FROM account_activity s
    WHERE s.church_id=a.church_id AND s.action=a.action AND s.outcome='succeeded' AND s.id>a.id
      AND (a.target_id IS NULL OR s.target_id=a.target_id) ORDER BY s.id LIMIT 1) AS resolved_at
    FROM account_activity a WHERE a.church_id=? AND a.outcome='failed' ORDER BY a.id DESC`)
    .all(churchId) as Array<ActivityRow & { resolved_at: string | null }>;
  return rows.map((row) => ({
    id: `activity-${row.id}`,
    message: `${accountActionLabels[row.action]} failed.`,
    occurredAt: row.recorded_at,
    resolvedAt: row.resolved_at,
  }));
}

function localAccount(
  church: ChurchRow,
  external: Awaited<ReturnType<typeof identity>>,
  filename: string | undefined,
  now: Date,
): FounderChurchAccount {
  return withWorkspaceDatabase(filename, (database) => {
    const territoryRow = database
      .prepare('SELECT id FROM territories WHERE church_id=? ORDER BY created_at,id LIMIT 1')
      .get(church.id) as { id: string } | undefined;
    let territory: FounderChurchAccount['territory'] = null;
    let estimatedHomesReached = 0;
    if (territoryRow)
      runInWorkspace(
        { churchId: church.id, territoryId: territoryRow.id, timeZone: church.time_zone },
        () => {
          const saved = applyMvpCapabilities(getTerritoryWorkspace(filename));
          territory = {
            id: saved.id,
            address: saved.originAddress,
            center: saved.center,
            boundary: territoryBoundary(saved.center, saved.radiusMiles, saved.boundaryShape),
            distanceMiles: saved.radiusMiles,
            boundaryShape: saved.boundaryShape,
            estimatedHomes: saved.totals.eligibleHomes,
            segmentCount: saved.totals.eligibleSegments,
            importCompletedAt: saved.import.completedAt,
            warnings: saved.import.quality?.warnings ?? [],
          };
          const coverage = applyMvpCapabilities(
            getCoverageWorkspace(filename, calendarDateInTimeZone(now, church.time_zone)),
          );
          // Match Outreach Progress: count each currently represented outreach unit once,
          // using effective history so date corrections and undo remain truthful.
          estimatedHomesReached = coverage.segments
            .filter((s) =>
              s.roots.some(
                (r) => r.effectiveCoveredOn !== null && r.effectiveCoveredOn <= coverage.asOf,
              ),
            )
            .reduce((sum, s) => sum + s.estimatedHomes, 0);
        },
      );
    const counts = database
      .prepare(
        `SELECT COUNT(p.id) AS total,COALESCE(SUM(p.status='active'),0) AS active,COALESCE(SUM(p.status='completed'),0) AS completed,COALESCE(SUM(p.status='cancelled'),0) AS cancelled FROM packets p JOIN batches b ON b.id=p.batch_id AND b.church_id=p.church_id WHERE p.church_id=? AND b.finalized_at IS NOT NULL`,
      )
      .get(church.id) as Omit<FounderChurchAccount['packets'], 'batches' | 'estimatedHomesReached'>;
    const batches = (
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM batches WHERE church_id=? AND finalized_at IS NOT NULL',
        )
        .get(church.id) as { count: number }
    ).count;
    const jobs = database
      .prepare(
        'SELECT rowid AS sequence,* FROM territory_import_jobs WHERE church_id=? ORDER BY rowid DESC',
      )
      .all(church.id) as Array<{
      id: string;
      sequence: number;
      status: NonNullable<FounderChurchAccount['importJob']>['status'];
      stage: string;
      created_at: string;
      completed_at: string | null;
      error: string | null;
      draft_json: string;
    }>;
    const latestJob = jobs[0];
    const draft = latestJob ? (JSON.parse(latestJob.draft_json) as TerritoryDraftInput) : null;
    const importJob: FounderChurchAccount['importJob'] =
      latestJob && draft
        ? {
            id: latestJob.id,
            status: latestJob.status,
            stage: latestJob.stage,
            createdAt: latestJob.created_at,
            completedAt: latestJob.completed_at,
            error: latestJob.error,
            attemptedAddress: draft.originAddress,
            attemptedDistanceMiles: draft.radiusMiles,
            attemptedBoundaryShape: draft.boundaryShape,
          }
        : null;
    const page = activityPage(database, church.id);
    const activityTotal = (
      database
        .prepare('SELECT COUNT(*) AS count FROM account_activity WHERE church_id=?')
        .get(church.id) as { count: number }
    ).count;
    const administrators = external.administrators.map((admin) => ({
      ...admin,
      lastActivityAt:
        (
          database
            .prepare(
              'SELECT recorded_at FROM account_activity WHERE church_id=? AND user_id=? ORDER BY id DESC LIMIT 1',
            )
            .get(church.id, admin.userId) as { recorded_at: string } | undefined
        )?.recorded_at ?? null,
    }));
    const issues = recordedIssues(database, church.id);
    for (const job of jobs.filter((j) => j.status === 'failed' || j.status === 'interrupted')) {
      const recovery = jobs
        .filter((j) => j.sequence > job.sequence && j.status === 'succeeded')
        .at(-1);
      issues.push({
        id: `import-${job.id}`,
        message:
          job.status === 'interrupted'
            ? 'Territory import was interrupted.'
            : 'Territory import failed.',
        occurredAt: job.completed_at ?? job.created_at,
        resolvedAt: recovery?.completed_at ?? null,
      });
    }
    const savedTerritory = territory as FounderChurchAccount['territory'];
    for (const [index, warning] of (savedTerritory?.warnings ?? []).entries())
      issues.push({
        id: `warning-${index}`,
        message: warning,
        occurredAt: savedTerritory?.importCompletedAt ?? null,
        resolvedAt: null,
      });
    if (church.auth_organization_id && !external.identityAvailable)
      issues.push({
        id: 'identity-unavailable',
        message: 'WorkOS account status could not be refreshed. Refresh to try again.',
        occurredAt: now.toISOString(),
        resolvedAt: null,
      });
    const setupStatus: FounderChurchAccount['setupStatus'] =
      importJob && ['queued', 'running'].includes(importJob.status)
        ? 'importing'
        : church.onboarding_completed_at
          ? 'ready'
          : savedTerritory
            ? 'setting_up'
            : external.invitation?.state === 'accepted'
              ? 'accepted'
              : external.invitation?.state === 'pending'
                ? 'invitation_pending'
                : external.invitation?.state === 'expired'
                  ? 'expired'
                  : external.invitation?.state === 'revoked'
                    ? 'revoked'
                    : external.invitation?.state === 'unavailable'
                      ? 'unavailable'
                      : 'setting_up';
    return {
      id: church.id,
      name: church.name,
      timeZone: church.time_zone,
      accessLabel: church.access_kind,
      createdAt: church.created_at,
      contact: church.contact_name
        ? { name: church.contact_name, email: church.email ?? '', location: church.location ?? '' }
        : null,
      setupStatus,
      ...external,
      administrators,
      territory: savedTerritory,
      importJob,
      packets: { ...counts, batches, estimatedHomesReached },
      lastActivity: page.activities[0] ?? null,
      activities: page.activities,
      activityTotal,
      issues,
    };
  });
}

// Callers must pass the founder authorization gate before invoking these cross-church reads.
export async function listFounderChurchAccounts(
  filename?: string,
  adapter?: FounderIdentityAdapter,
  now = new Date(),
): Promise<FounderAccountsSnapshot> {
  const churches = withWorkspaceDatabase(
    filename,
    (database) =>
      database
        .prepare(
          `SELECT c.*,p.auth_invitation_id,p.invite_email,p.contact_name,p.email,p.location FROM churches c LEFT JOIN pilot_requests p ON p.provisioned_church_id=c.id ORDER BY c.name,c.id`,
        )
        .all() as ChurchRow[],
  );
  let workos = adapter;
  try {
    workos ??= await createFounderIdentityAdapter();
  } catch {
    /* Preserve local data when WorkOS is unavailable. */
  }
  const identities = await Promise.all(churches.map((church) => identity(church, workos)));
  return {
    churches: churches.map((church, i) => localAccount(church, identities[i], filename, now)),
    checkedAt: now.toISOString(),
  };
}
