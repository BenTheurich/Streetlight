import { AdministratorEntry } from '@/components/AdministratorEntry';
import { PublicLanding } from '@/components/PublicLanding';
import {
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getCoverageWorkspace } from '@/lib/coverage-persistence';
import { isFounderEmail } from '@/lib/founder-auth';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';
import { listPilotRequests } from '@/lib/pilot-requests';
import { getChurchPrintoutSettings } from '@/lib/printout-settings-persistence';
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
      <AdministratorEntry
        view="onboarding"
        properties={{
          churchName: session.access.churchName,
          initialTimeZone: session.access.timeZone,
          mapsApiKey: getGoogleMapsBrowserKey(),
          timeZones: Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])),
        }}
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
    <AdministratorEntry
      view="workspace"
      properties={{
        administratorEmail: session.user.email,
        initialData,
        initialPrintoutSettings,
        mapsApiKey: getGoogleMapsBrowserKey(),
        pendingPilotRequests,
        setupOnly: !session.access.onboardingCompleted,
      }}
    />
  );
}
