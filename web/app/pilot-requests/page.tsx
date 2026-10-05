import '../workspace.css';
import '../administrator-page.css';
import './pilot-requests.css';
import { notFound } from 'next/navigation';
import { PilotRequestReview } from '@/components/PilotRequestReview';
import { FounderAccessNotFoundError, requireFounderSession } from '@/lib/founder-auth';
import { readPilotInvitationStatuses } from '@/lib/founder-church-accounts';
import { listPilotRequests } from '@/lib/pilot-requests';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access requests | Streetlight' };

export default async function PilotRequestsPage() {
  let session: Awaited<ReturnType<typeof requireFounderSession>>;
  try {
    session = await requireFounderSession();
  } catch (error) {
    if (error instanceof FounderAccessNotFoundError) notFound();
    throw error;
  }
  const requests = listPilotRequests();
  return (
    <PilotRequestReview
      initialRequests={requests}
      administratorEmail={session.email}
      invitationStatuses={await readPilotInvitationStatuses(requests)}
    />
  );
}
