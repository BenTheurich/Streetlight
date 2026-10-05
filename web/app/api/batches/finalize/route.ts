import { withAccountActivity } from '../../../../lib/account-activity.ts';
import { authenticatedRoute } from '../../../../lib/authenticated-route.ts';
import {
  type PacketFinalizationInput,
  PacketProposalConflictError,
  parsePacketFinalizationInput,
} from '../../../../lib/packet-finalization.ts';
import { finalizePacketBatch } from '../../../../lib/packet-persistence.ts';

export async function finalizePacketBatchRequest(request: Request): Promise<Response> {
  let input: PacketFinalizationInput;
  try {
    input = parsePacketFinalizationInput(await request.json());
  } catch {
    return Response.json({ error: 'Invalid finalization request' }, { status: 400 });
  }

  try {
    const batch = finalizePacketBatch(input);
    return withAccountActivity(Response.json(batch, { status: 201 }), { targetId: batch.id });
  } catch (error) {
    if (error instanceof PacketProposalConflictError) {
      return Response.json(
        { error: 'Packet proposals changed. Generate proposals again.' },
        { status: 409 },
      );
    }
    return Response.json({ error: 'Could not finalize packet batch' }, { status: 500 });
  }
}

export const POST = authenticatedRoute(
  finalizePacketBatchRequest,
  undefined,
  undefined,
  false,
  'batch_finalization',
);
