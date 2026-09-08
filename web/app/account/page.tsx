import '../workspace.css';
import '../administrator-page.css';
import './account.css';
import { notFound, redirect } from 'next/navigation';
import { ChurchAccount } from '@/components/ChurchAccount';
import {
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getChurchAccount } from '@/lib/church-account';
import {
  AdministratorAccessError,
  type AdministratorRoster,
  listChurchAdministrators,
} from '@/lib/church-administrators';
import { isFounderEmail } from '@/lib/founder-auth';
import { listPilotRequests } from '@/lib/pilot-requests';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Church account | Streetlight' };

export default async function ChurchAccountPage() {
  let session: OrganizationSession;
  try {
    session = await requireOrganizationSession();
  } catch (error) {
    if (error instanceof SignInRequiredError) redirect('/login');
    if (error instanceof ChurchWorkspaceAccessError) notFound();
    throw error;
  }

  const account = getChurchAccount(session.organizationId);
  let roster: AdministratorRoster | null = null;
  let rosterError = '';
  try {
    roster = await listChurchAdministrators(session.organizationId, session.user.id);
  } catch (error) {
    if (error instanceof AdministratorAccessError) notFound();
    rosterError = 'Could not load administrators. Try again.';
  }
  const pendingPilotRequests = isFounderEmail(session.user.email)
    ? listPilotRequests().filter(({ status }) => status === 'pending' || status === 'provisioning')
        .length
    : null;

  return (
    <ChurchAccount
      account={account}
      administratorEmail={session.user.email}
      initialRoster={roster}
      initialRosterError={rosterError}
      pendingPilotRequests={pendingPilotRequests}
    />
  );
}
