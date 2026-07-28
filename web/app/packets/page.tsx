import { PacketGenerator } from '@/components/PacketGenerator';
import { getTerritoryWorkspace } from '@/lib/database';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';

export const dynamic = 'force-dynamic';

export default function PacketProposalsPage() {
  return (
    <PacketGenerator
      center={getTerritoryWorkspace().center}
      mapsApiKey={getGoogleMapsBrowserKey()}
    />
  );
}
