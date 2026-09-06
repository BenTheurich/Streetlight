import type { WorkOS } from '@workos-inc/node';
import { getOrganizationAccess } from './church-workspace-persistence.ts';
import type { OrganizationAccess } from './organization-access.ts';
import type { WorkspaceScope } from './workspace-scope.ts';

export type AdministratorUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

export type ExternalAuthSession = {
  user: AdministratorUser | null;
  organizationId?: string | null;
};

export type AuthLoader = () => Promise<ExternalAuthSession>;

export type AdministratorSession = {
  user: AdministratorUser;
  workspace: WorkspaceScope;
  onboardingCompleted: boolean;
};

export type OrganizationSession = {
  user: AdministratorUser;
  organizationId: string;
  access: OrganizationAccess;
};

export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in required');
  }
}

export class ChurchWorkspaceAccessError extends Error {
  constructor() {
    super('Church workspace access required');
  }
}

export async function loadWorkOSSession(
  loadSession?: AuthLoader,
  client?: WorkOS,
): Promise<ExternalAuthSession> {
  const session = loadSession
    ? await loadSession()
    : await (await import('@workos-inc/authkit-nextjs')).withAuth();
  if (!session.user || !session.organizationId) return session;

  // An access token can outlive its membership. Check WorkOS before trusting its org claim.
  try {
    const { WorkOS } = await import('@workos-inc/node');
    const workos = client ?? new WorkOS(process.env.WORKOS_API_KEY);
    const memberships = await workos.userManagement.listOrganizationMemberships({
      organizationId: session.organizationId,
      userId: session.user.id,
      statuses: ['active'],
      limit: 1,
    });
    if (
      !memberships.data.some(
        (membership) =>
          membership.organizationId === session.organizationId &&
          membership.userId === session.user?.id &&
          membership.status === 'active',
      )
    )
      throw new ChurchWorkspaceAccessError();
  } catch {
    throw new ChurchWorkspaceAccessError();
  }
  return session;
}

export async function requireAdministratorSession(
  loadSession: AuthLoader = loadWorkOSSession,
  filename?: string,
): Promise<AdministratorSession> {
  const session = await requireOrganizationSession(loadSession, filename);
  if (!session.access.territoryId) throw new ChurchWorkspaceAccessError();
  return {
    user: session.user,
    workspace: {
      churchId: session.access.churchId,
      territoryId: session.access.territoryId,
      timeZone: session.access.timeZone,
    },
    onboardingCompleted: session.access.onboardingCompleted,
  };
}

export async function requireOrganizationSession(
  loadSession: AuthLoader = loadWorkOSSession,
  filename?: string,
): Promise<OrganizationSession> {
  const session = await loadSession();
  if (!session.user) {
    throw new SignInRequiredError();
  }
  if (!session.organizationId) {
    throw new ChurchWorkspaceAccessError();
  }

  try {
    return {
      user: session.user,
      organizationId: session.organizationId,
      access: getOrganizationAccess(session.organizationId, filename),
    };
  } catch {
    throw new ChurchWorkspaceAccessError();
  }
}
