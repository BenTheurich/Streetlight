import { StreetlightWorkspace } from '@/components/StreetlightWorkspace';
import { getCoverageWorkspace } from '@/lib/database';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';

export const dynamic = 'force-dynamic';

export default function CoverageDashboardPage() {
  return (
    <StreetlightWorkspace
      initialData={getCoverageWorkspace()}
      mapsApiKey={getGoogleMapsBrowserKey()}
    />
  );
}
