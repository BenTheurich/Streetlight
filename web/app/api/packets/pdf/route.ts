import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { getPacketDownloadSelection } from '../../../../lib/database.ts';
import { getGoogleMapsServerKey } from '../../../../lib/google-maps-server.ts';
import { renderPacketMap, renderPacketPdf } from '../../../../lib/packet-pdf.ts';

export async function getPacketPdf(request: Request): Promise<Response> {
  const scope = new URL(request.url).searchParams.get('scope');
  if (scope !== 'newest' && scope !== 'active') {
    return Response.json({ error: 'Invalid packet download scope' }, { status: 400 });
  }
  const apiKey = getGoogleMapsServerKey();
  if (!apiKey) {
    return Response.json({ error: 'Packet maps are not configured' }, { status: 503 });
  }

  try {
    const selection = getPacketDownloadSelection(scope);
    const logo = await readFile(path.join(process.cwd(), 'public', 'StreetlightLogo.png'));
    const bytes = await renderPacketPdf(selection, {
      logo,
      renderMap: (packet) => renderPacketMap(packet, apiKey),
    });
    const filename =
      scope === 'newest' ? 'streetlight-newest-batch.pdf' : 'streetlight-active-packets.pdf';
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'No packets available') {
      return Response.json({ error: 'No packets available' }, { status: 404 });
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('Google Roads') || error.message.startsWith('Google Static Maps'))
    ) {
      return Response.json({ error: 'Could not render packet maps' }, { status: 502 });
    }
    return Response.json({ error: 'Could not create packet PDF' }, { status: 500 });
  }
}

export const GET = authenticatedRoute(getPacketPdf);
