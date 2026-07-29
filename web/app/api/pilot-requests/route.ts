import {
  type PilotRequestInput,
  parsePilotRequest,
  submitPilotRequest,
} from '../../../lib/pilot-requests.ts';

export async function submitPublicPilotRequest(
  request: Request,
  databaseFilename?: string,
): Promise<Response> {
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
    { status: result.created ? 201 : 200 },
  );
}

export const POST = submitPublicPilotRequest;
