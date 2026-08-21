import { ChurchOnboarding } from '@/components/ChurchOnboarding';
import { PublicLanding } from '@/components/PublicLanding';
import { StreetlightWorkspace } from '@/components/StreetlightWorkspace';
import {
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getChurchPrintoutSettings, getCoverageWorkspace } from '@/lib/database';
import { isFounderEmail } from '@/lib/founder-auth';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';
import { listPilotRequests } from '@/lib/pilot-requests';
import { applyMvpCapabilities } from '@/lib/product-capabilities';
import { runInWorkspace } from '@/lib/workspace-scope';

export const dynamic = 'force-dynamic';

export default async function CoverageDashboardPage() {
  let session: OrganizationSession;
  try {
    session = await requireOrganizationSession();
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

  if (!session.access.territoryId) {
    return (
      <ChurchOnboarding
        churchName={session.access.churchName}
        initialTimeZone={session.access.timeZone}
        mapsApiKey={getGoogleMapsBrowserKey()}
        timeZones={Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]))}
      />
    );
  }
  const workspace = {
    churchId: session.access.churchId,
    territoryId: session.access.territoryId,
    timeZone: session.access.timeZone,
  };
  const [initialData, initialPrintoutSettings] = runInWorkspace(workspace, () => [
    applyMvpCapabilities(getCoverageWorkspace()),
    getChurchPrintoutSettings(),
  ]);
  const pendingPilotRequests = isFounderEmail(session.user.email)
    ? listPilotRequests().filter(({ status }) => status === 'pending' || status === 'provisioning')
        .length
    : null;
  return (
    <StreetlightWorkspace
      administratorEmail={session.user.email}
      initialData={initialData}
      initialPrintoutSettings={initialPrintoutSettings}
      mapsApiKey={getGoogleMapsBrowserKey()}
      pendingPilotRequests={pendingPilotRequests}
      setupOnly={!session.access.onboardingCompleted}
    />
  );
}
