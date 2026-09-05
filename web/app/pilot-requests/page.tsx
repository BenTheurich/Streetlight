import '../workspace.css';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';
import { notFound } from 'next/navigation';
import { PilotRequestReview } from '@/components/PilotRequestReview';
import { FounderAccessNotFoundError, requireFounderSession } from '@/lib/founder-auth';
import { listPilotRequests } from '@/lib/pilot-requests';

export const dynamic = 'force-dynamic';

export default async function PilotRequestsPage() {
  try {
    await requireFounderSession();
  } catch (error) {
    if (error instanceof FounderAccessNotFoundError) notFound();
    throw error;
  }
  return (
    <AuthKitProvider>
      <PilotRequestReview initialRequests={listPilotRequests()} />
    </AuthKitProvider>
  );
}
