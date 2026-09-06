import { limitPublicPilotRequest } from '../../../lib/pilot-request-rate-limit.ts';
import {
  type PilotRequestInput,
  parsePilotRequest,
  submitPilotRequest,
} from '../../../lib/pilot-requests.ts';

export async function submitPublicPilotRequest(
  request: Request,
  databaseFilename?: string,
): Promise<Response> {
  const limited = limitPublicPilotRequest(request, databaseFilename);
  if (limited) return limited;

  let input: PilotRequestInput;
  try {
    input = parsePilotRequest(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 },
    );
  }

  const result = submitPilotRequest(input, databaseFilename);
  return Response.json(
    {
      message: `Request received. We'll review it and contact you at ${result.email}.`,
    },
    { status: 200 },
  );
}

export function POST(request: Request): Promise<Response> {
  return submitPublicPilotRequest(request);
}
