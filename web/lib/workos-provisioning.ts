import {
  beginPilotProvisioning,
  type PilotRequest,
  recordPilotInvitation,
  recordPilotOrganization,
} from './pilot-requests.ts';

export type WorkOSProvisioningAdapter = {
  findOrCreateOrganization(externalId: string, name: string): Promise<{ id: string }>;
  findOrCreateInvitation(organizationId: string, email: string): Promise<{ id: string }>;
};

const inFlightProvisioning = new Map<string, Promise<PilotRequest>>();

async function workOSAdapter(): Promise<WorkOSProvisioningAdapter> {
  const { NotFoundException, WorkOS } = await import('@workos-inc/node');
  const workos = new WorkOS(process.env.WORKOS_API_KEY);
  return {
    async findOrCreateOrganization(externalId, name) {
      try {
        return await workos.organizations.getOrganizationByExternalId(externalId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        return workos.organizations.createOrganization(
          { name, externalId },
          { idempotencyKey: `streetlight-${externalId}` },
        );
      }
    },
    async findOrCreateInvitation(organizationId, email) {
      const existing = await workos.userManagement.listInvitations({
        organizationId,
        email,
        limit: 1,
      });
      return (
        existing.data[0] ??
        (await workos.userManagement.sendInvitation({
          organizationId,
          email,
          expiresInDays: 30,
        }))
      );
    },
  };
}

async function provisionPilotRequestOnce(
  requestId: string,
  corrections: { churchName: string; email: string },
  adapter?: WorkOSProvisioningAdapter,
  filename?: string,
): Promise<PilotRequest> {
  const workos = adapter ?? (await workOSAdapter());
  let request = beginPilotProvisioning(requestId, corrections, filename);
  if (!request.authOrganizationId) {
    if (!request.provisionedChurchId || !request.approvedChurchName) {
      throw new Error('Pilot request is not ready for organization provisioning');
    }
    const organization = await workos.findOrCreateOrganization(
      request.provisionedChurchId,
      request.approvedChurchName,
    );
    request = recordPilotOrganization(requestId, organization.id, filename);
  }
  if (!request.authInvitationId) {
    if (!request.authOrganizationId || !request.inviteEmail) {
      throw new Error('Pilot request is not ready for an invitation');
    }
    const invitation = await workos.findOrCreateInvitation(
      request.authOrganizationId,
      request.inviteEmail,
    );
    request = recordPilotInvitation(requestId, invitation.id, filename);
  }
  return request;
}

export async function provisionPilotRequest(
  requestId: string,
  corrections: { churchName: string; email: string },
  adapter?: WorkOSProvisioningAdapter,
  filename?: string,
): Promise<PilotRequest> {
  const existing = inFlightProvisioning.get(requestId);
  if (existing) return existing;

  const pending = provisionPilotRequestOnce(requestId, corrections, adapter, filename);
  inFlightProvisioning.set(requestId, pending);
  try {
    return await pending;
  } finally {
    if (inFlightProvisioning.get(requestId) === pending) {
      inFlightProvisioning.delete(requestId);
    }
  }
}
