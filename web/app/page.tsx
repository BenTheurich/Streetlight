import { CoverageDashboard } from '@/components/CoverageDashboard';
import { getCoverageWorkspace } from '@/lib/database';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';

export const dynamic = 'force-dynamic';

export default function CoverageDashboardPage() {
  return (
    <CoverageDashboard
      initialData={getCoverageWorkspace()}
      mapsApiKey={getGoogleMapsBrowserKey()}
    />
  );
}
