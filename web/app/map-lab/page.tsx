import { notFound, redirect } from 'next/navigation';
import { MapLab } from '@/components/MapLab';
import {
  ChurchWorkspaceAccessError,
  type OrganizationSession,
  requireOrganizationSession,
  SignInRequiredError,
} from '@/lib/auth';
import { getCoverageWorkspace, getMapLabBuildingCounts } from '@/lib/database';
import { isFounderEmail } from '@/lib/founder-auth';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';
import { runInWorkspace } from '@/lib/workspace-scope';

export const dynamic = 'force-dynamic';

export default async function MapLabPage() {
  let session: OrganizationSession;
  try {
    session = await requireOrganizationSession();
  } catch (error) {
    if (error instanceof SignInRequiredError) redirect('/login');
    if (error instanceof ChurchWorkspaceAccessError) notFound();
    throw error;
  }
  if (!isFounderEmail(session.user.email) || !session.access.territoryId) notFound();
  const initial = runInWorkspace(
    {
      churchId: session.access.churchId,
      territoryId: session.access.territoryId,
      timeZone: session.access.timeZone,
    },
    () => ({
      coverage: getCoverageWorkspace(),
      buildingCounts: getMapLabBuildingCounts(),
    }),
  );
  return (
    <MapLab
      buildingCounts={initial.buildingCounts}
      initialData={initial.coverage}
      mapsApiKey={getGoogleMapsBrowserKey()}
    />
  );
}
