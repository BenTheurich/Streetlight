import type { Invitation, OrganizationMembership, User, WorkOS } from '@workos-inc/node';

export type AdministratorRoster = {
  administrators: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    isCurrentUser: boolean;
  }>;
  invitations: Array<{ id: string; email: string }>;
};

export type AdministratorAction =
  | { action: 'invite'; email: string }
  | { action: 'revoke'; id: string }
  | { action: 'remove'; id: string };

export type WorkOSAdministratorsAdapter = {
  listMemberships(
    organizationId: string,
  ): Promise<Array<Pick<OrganizationMembership, 'id' | 'organizationId' | 'userId' | 'status'>>>;
  listInvitations(
    organizationId: string,
  ): Promise<Array<Pick<Invitation, 'id' | 'organizationId' | 'email' | 'state'>>>;
  getUser(userId: string): Promise<Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>>;
  sendInvitation(organizationId: string, email: string, inviterUserId: string): Promise<unknown>;
  revokeInvitation(id: string): Promise<unknown>;
  removeMembership(id: string): Promise<void>;
};

export class AdministratorAccessError extends Error {
  constructor() {
    super('Active church administrator access required');
  }
}

export class AdministratorActionError extends Error {}

export async function createWorkOSAdministratorsAdapter(
  client?: WorkOS,
): Promise<WorkOSAdministratorsAdapter> {
  const { WorkOS } = await import('@workos-inc/node');
  const { userManagement } = client ?? new WorkOS(process.env.WORKOS_API_KEY);
  return {
    async listMemberships(organizationId) {
      return (
        await userManagement.listOrganizationMemberships({ organizationId, statuses: ['active'] })
      ).autoPagination();
    },
    async listInvitations(organizationId) {
      return (await userManagement.listInvitations({ organizationId })).autoPagination();
    },
    getUser: (id) => userManagement.getUser(id),
    sendInvitation: (organizationId, email, inviterUserId) =>
      userManagement.sendInvitation({ organizationId, email, inviterUserId, expiresInDays: 30 }),
    revokeInvitation: (id) => userManagement.revokeInvitation(id),
    removeMembership: (id) => userManagement.deleteOrganizationMembership(id),
  };
}

export function parseAdministratorAction(value: unknown): AdministratorAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdministratorActionError('Invalid administrator action');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  if (input.action === 'invite' && keys === 'action,email' && typeof input.email === 'string') {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new AdministratorActionError('Enter a valid email address');
    }
    return { action: 'invite', email };
  }
  if (
    (input.action === 'remove' || input.action === 'revoke') &&
    keys === 'action,id' &&
    typeof input.id === 'string' &&
    input.id.trim() &&
    input.id.length <= 200
  ) {
    return { action: input.action, id: input.id };
  }
  throw new AdministratorActionError('Invalid administrator action');
}

async function activeMemberships(
  organizationId: string,
  currentUserId: string,
  adapter: WorkOSAdministratorsAdapter,
) {
  if (!organizationId || !currentUserId) throw new AdministratorAccessError();
  const memberships = (await adapter.listMemberships(organizationId)).filter(
    (membership) => membership.organizationId === organizationId && membership.status === 'active',
  );
  if (!memberships.some((membership) => membership.userId === currentUserId)) {
    throw new AdministratorAccessError();
  }
  return memberships;
}

async function pendingInvitations(organizationId: string, adapter: WorkOSAdministratorsAdapter) {
  return (await adapter.listInvitations(organizationId)).filter(
    (invitation) => invitation.organizationId === organizationId && invitation.state === 'pending',
  );
}

export async function listChurchAdministrators(
  organizationId: string,
  currentUserId: string,
  adapter?: WorkOSAdministratorsAdapter,
): Promise<AdministratorRoster> {
  const workos = adapter ?? (await createWorkOSAdministratorsAdapter());
  const memberships = await activeMemberships(organizationId, currentUserId, workos);
  const [administrators, invitations] = await Promise.all([
    Promise.all(
      memberships.map(async (membership) => {
        const user = await workos.getUser(membership.userId);
        return {
          id: membership.id,
          userId: membership.userId,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
          email: user.email,
          isCurrentUser: membership.userId === currentUserId,
        };
      }),
    ),
    pendingInvitations(organizationId, workos),
  ]);
  return {
    administrators: administrators.sort(
      (a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser) || a.email.localeCompare(b.email),
    ),
    invitations: invitations
      .map(({ id, email }) => ({ id, email }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

// ponytail: one application process in the pilot; coordinate sends across replicas before scaling.
const inFlightInvitations = new Map<string, Promise<{ message: string }>>();

async function inviteAdministrator(
  organizationId: string,
  currentUserId: string,
  email: string,
  adapter: WorkOSAdministratorsAdapter,
): Promise<{ message: string }> {
  const existing = await pendingInvitations(organizationId, adapter);
  if (existing.some((invitation) => invitation.email.toLowerCase() === email)) {
    return { message: 'An invitation is already pending for this email.' };
  }
  try {
    await adapter.sendInvitation(organizationId, email, currentUserId);
  } catch (error) {
    // An accepted provider request can lose its response. Check before asking for a retry.
    if (
      !(await pendingInvitations(organizationId, adapter)).some(
        (invitation) => invitation.email.toLowerCase() === email,
      )
    ) {
      throw error;
    }
  }
  return { message: 'Invitation sent.' };
}

export async function mutateChurchAdministrator(
  organizationId: string,
  currentUserId: string,
  input: AdministratorAction,
  adapter?: WorkOSAdministratorsAdapter,
): Promise<{ message: string }> {
  const action = parseAdministratorAction(input);
  const workos = adapter ?? (await createWorkOSAdministratorsAdapter());
  const memberships = await activeMemberships(organizationId, currentUserId, workos);
  if (action.action === 'remove') {
    const target = memberships.find((membership) => membership.id === action.id);
    if (!target) throw new AdministratorActionError('Administrator not found in this church');
    if (target.userId === currentUserId)
      throw new AdministratorActionError('You cannot remove yourself');
    await workos.removeMembership(target.id);
    return { message: 'Administrator removed.' };
  }
  if (action.action === 'revoke') {
    const target = (await pendingInvitations(organizationId, workos)).find(
      (invitation) => invitation.id === action.id,
    );
    if (!target) throw new AdministratorActionError('Pending invitation not found in this church');
    await workos.revokeInvitation(target.id);
    return { message: 'Invitation revoked.' };
  }
  const users = await Promise.all(
    memberships.map((membership) => workos.getUser(membership.userId)),
  );
  if (users.some((user) => user.email.toLowerCase() === action.email)) {
    return { message: 'This person is already an administrator.' };
  }
  const key = `${organizationId}:${action.email}`;
  const existing = inFlightInvitations.get(key);
  if (existing) return existing;
  const pending = inviteAdministrator(organizationId, currentUserId, action.email, workos);
  inFlightInvitations.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightInvitations.get(key) === pending) inFlightInvitations.delete(key);
  }
}
