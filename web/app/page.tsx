import { PublicLanding } from '@/components/PublicLanding';
import { StreetlightWorkspace } from '@/components/StreetlightWorkspace';
import {
  type AdministratorSession,
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getCoverageWorkspace } from '@/lib/database';
import { isFounderEmail } from '@/lib/founder-auth';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';
import { listPilotRequests } from '@/lib/pilot-requests';
import { runInWorkspace } from '@/lib/workspace-scope';

export const dynamic = 'force-dynamic';

export default async function CoverageDashboardPage() {
  let session: AdministratorSession;
  try {
    session = await requireAdministratorSession();
  } catch (error) {
    if (error instanceof SignInRequiredError) {
      return <PublicLanding />;
    }
    if (error instanceof ChurchWorkspaceAccessError) {
      return (
        <main className="workspace-access-error">
          <h1>Church workspace unavailable</h1>
          <p>Ask the Streetlight pilot administrator to add you to your church.</p>
          <a href="/logout">Sign out</a>
        </main>
      );
    }
    throw error;
  }

  const initialData = runInWorkspace(session.workspace, () => getCoverageWorkspace());
  const pendingPilotRequests = isFounderEmail(session.user.email)
    ? listPilotRequests().filter(({ status }) => status === 'pending' || status === 'provisioning')
        .length
    : null;
  return (
    <StreetlightWorkspace
      administratorEmail={session.user.email}
      initialData={initialData}
      mapsApiKey={getGoogleMapsBrowserKey()}
      pendingPilotRequests={pendingPilotRequests}
    />
  );
}
