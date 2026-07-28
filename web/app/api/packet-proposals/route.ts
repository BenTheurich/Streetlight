import { getPacketGenerationWorkspace } from '../../../lib/database.ts';
import { withProposalFingerprint } from '../../../lib/packet-finalization.ts';
import {
  generatePacketProposals,
  type PacketSizeRequest,
  parsePacketSizeRequests,
} from '../../../lib/packet-selection.ts';

export async function POST(request: Request): Promise<Response> {
  let requests: PacketSizeRequest[];
  try {
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, 'requests')
    ) {
      throw new Error('Invalid packet request');
    }
    requests = parsePacketSizeRequests((body as { requests: unknown }).requests);
  } catch {
    return Response.json({ error: 'Invalid packet request' }, { status: 400 });
  }

  try {
    const workspace = getPacketGenerationWorkspace();
    return Response.json(
      withProposalFingerprint(generatePacketProposals({ ...workspace, requests })),
    );
  } catch {
    return Response.json({ error: 'Could not generate packet proposals' }, { status: 500 });
  }
}
