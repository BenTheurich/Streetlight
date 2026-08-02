import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { getChurchPrintoutSettings, getPacketDownloadSelection } from '../../../../lib/database.ts';
import { renderOpenPacketMaps } from '../../../../lib/open-map-renderer.ts';
import type { PacketDownloadSelection } from '../../../../lib/packet-finalization.ts';
import { renderPacketPdf } from '../../../../lib/packet-pdf.ts';

type PacketPdfOptions = {
  renderMaps?: (selection: PacketDownloadSelection) => Promise<Map<string, Uint8Array>>;
};

export async function getPacketPdf(
  request: Request,
  options: PacketPdfOptions = {},
): Promise<Response> {
  const scope = new URL(request.url).searchParams.get('scope');
  if (scope !== 'newest' && scope !== 'active') {
    return Response.json({ error: 'Invalid packet download scope' }, { status: 400 });
  }
  try {
    const selection = getPacketDownloadSelection(scope);
    const logo = await readFile(path.join(process.cwd(), 'public', 'StreetlightLogo.png'));
    const maps = await (options.renderMaps ?? renderOpenPacketMaps)(selection);
    const bytes = await renderPacketPdf(selection, {
      logo,
      footer: getChurchPrintoutSettings(),
      renderMap: async (packet) => {
        const map = maps.get(packet.id);
        if (!map) throw new Error('Could not render packet maps');
        return map;
      },
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
    if (error instanceof Error && error.message.startsWith('Could not render packet maps')) {
      return Response.json({ error: 'Could not render packet maps' }, { status: 502 });
    }
    return Response.json({ error: 'Could not create packet PDF' }, { status: 500 });
  }
}

export const GET = authenticatedRoute(getPacketPdf);
