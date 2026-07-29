import { getWorkspaceForOrganization } from './database.ts';
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

async function loadWorkOSSession(): Promise<ExternalAuthSession> {
  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  return withAuth();
}

export async function requireAdministratorSession(
  loadSession: AuthLoader = loadWorkOSSession,
  filename?: string,
): Promise<AdministratorSession> {
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
      workspace: getWorkspaceForOrganization(session.organizationId, filename),
    };
  } catch {
    throw new ChurchWorkspaceAccessError();
  }
}
