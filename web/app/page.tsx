import { redirect } from 'next/navigation';
import { StreetlightWorkspace } from '@/components/StreetlightWorkspace';
import {
  type AdministratorSession,
  ChurchWorkspaceAccessError,
  requireAdministratorSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getCoverageWorkspace } from '@/lib/database';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';
import { runInWorkspace } from '@/lib/workspace-scope';

export const dynamic = 'force-dynamic';

export default async function CoverageDashboardPage() {
  let session: AdministratorSession;
  try {
    session = await requireAdministratorSession();
  } catch (error) {
    if (error instanceof SignInRequiredError) {
      redirect('/login');
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
  return (
    <StreetlightWorkspace
      administratorEmail={session.user.email}
      initialData={initialData}
      mapsApiKey={getGoogleMapsBrowserKey()}
    />
  );
}
