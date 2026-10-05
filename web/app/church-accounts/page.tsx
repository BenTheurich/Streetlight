import '../workspace.css';
import '../administrator-page.css';
import './accounts.css';
import { notFound } from 'next/navigation';
import { FounderChurchAccounts } from '@/components/FounderChurchAccounts';
import { FounderAccessNotFoundError, requireFounderSession } from '@/lib/founder-auth';
import { listFounderChurchAccounts } from '@/lib/founder-church-accounts';
import { listPilotRequests } from '@/lib/pilot-requests';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Church accounts | Streetlight' };

export default async function ChurchAccountsPage() {
  let session: Awaited<ReturnType<typeof requireFounderSession>>;
  try {
    session = await requireFounderSession();
  } catch (error) {
    if (error instanceof FounderAccessNotFoundError) notFound();
    throw error;
  }
  const initialSnapshot = await listFounderChurchAccounts();
  const pendingPilotRequests = listPilotRequests().filter(
    (r) => r.status === 'pending' || r.status === 'provisioning',
  ).length;
  return (
    <FounderChurchAccounts
      initialSnapshot={initialSnapshot}
      administratorEmail={session.email}
      pendingPilotRequests={pendingPilotRequests}
    />
  );
}
