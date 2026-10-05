import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withAccountActivity } from '../../../../lib/account-activity.ts';
import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import { renderOpenPacketMaps } from '../../../../lib/open-map-renderer.ts';
import type { PacketDownloadSelection } from '../../../../lib/packet-finalization.ts';
import { renderPacketPdf } from '../../../../lib/packet-pdf.ts';
import { getPacketDownloadSelection } from '../../../../lib/packet-persistence.ts';
import { getChurchPrintoutSettings } from '../../../../lib/printout-settings-persistence.ts';

type PacketPdfOptions = {
  renderMaps?: (selection: PacketDownloadSelection) => Promise<Map<string, Uint8Array>>;
};

export async function getPacketPdf(
  request: Request,
  options: PacketPdfOptions = {},
): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const scope = parameters.get('scope');
  const batchId = parameters.get('batchId');
  if (
    parameters.getAll('scope').length !== 1 ||
    (scope !== 'newest' && scope !== 'active' && scope !== 'batch') ||
    (scope === 'batch'
      ? parameters.getAll('batchId').length !== 1 || !batchId || batchId.trim() !== batchId
      : parameters.has('batchId'))
  ) {
    return Response.json({ error: 'Invalid packet download scope' }, { status: 400 });
  }
  let targetId: string | null = null;
  try {
    const selection = getPacketDownloadSelection(
      scope === 'batch' ? { batchId: batchId as string } : scope,
    );
    targetId = scope === 'batch' ? selection.packets[0].batchId : scope;
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
      scope === 'batch'
        ? 'streetlight-batch.pdf'
        : scope === 'newest'
          ? 'streetlight-newest-batch.pdf'
          : 'streetlight-active-packets.pdf';
    return withAccountActivity(
      new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        },
      }),
      { targetId },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'No packets available') {
      return Response.json({ error: 'No packets available' }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith('Could not render packet maps')) {
      return withAccountActivity(
        Response.json({ error: 'Could not render packet maps' }, { status: 502 }),
        { targetId },
      );
    }
    return withAccountActivity(
      Response.json({ error: 'Could not create packet PDF' }, { status: 500 }),
      { targetId },
    );
  }
}

export const GET = authenticatedRoute(getPacketPdf, undefined, undefined, false, 'pdf_preparation');
