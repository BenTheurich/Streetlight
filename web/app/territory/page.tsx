import { TerritoryEditor } from '@/components/TerritoryEditor';
import { getTerritoryWorkspace } from '@/lib/database';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';

export const dynamic = 'force-dynamic';

export default function TerritorySetupPage() {
  return (
    <TerritoryEditor initialData={getTerritoryWorkspace()} mapsApiKey={getGoogleMapsBrowserKey()} />
  );
}
