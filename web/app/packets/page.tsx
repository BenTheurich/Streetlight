import { PacketGenerator } from '@/components/PacketGenerator';
import { getGoogleMapsBrowserKey } from '@/lib/google-maps-server';

export const dynamic = 'force-dynamic';

export default function PacketProposalsPage() {
  return <PacketGenerator mapsApiKey={getGoogleMapsBrowserKey()} />;
}
