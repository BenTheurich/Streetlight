import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { withImmediateTransaction } from './sqlite-persistence.ts';

export function limitPublicPilotRequest(request: Request, filename?: string): Response | null {
  // Production is reachable only through cloudflared on the private Docker network.
  const trustedProxy = process.env.STREETLIGHT_TRUST_CLOUDFLARE === '1';
  if (!trustedProxy && process.env.NODE_ENV !== 'production') return null;

  const address = trustedProxy ? request.headers.get('cf-connecting-ip') : null;
  const family = address ? isIP(address) : 0;
  if (!address || !family || address.includes('%')) {
    return Response.json(
      { error: 'Access requests are temporarily unavailable.' },
      { status: 503 },
    );
  }

  const canonicalAddress = family === 6 ? new URL(`http://[${address}]/`).hostname : address;
  const clientHash = createHash('sha256').update(canonicalAddress).digest('hex');
  const now = Date.now();
  const windowEndsAt = (Math.floor(now / 3_600_000) + 1) * 3_600_000;
  const allowed = withImmediateTransaction(filename, (database) => {
    database.prepare('DELETE FROM pilot_request_rate_limits WHERE window_ends_at <= ?').run(now);
    return database
      .prepare(
        `INSERT INTO pilot_request_rate_limits (client_hash, window_ends_at, request_count)
        VALUES (?, ?, 1)
        ON CONFLICT (client_hash) DO UPDATE SET request_count = request_count + 1
          WHERE request_count < 5
        RETURNING request_count`,
      )
      .get(clientHash, windowEndsAt);
  });

  return allowed
    ? null
    : Response.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((windowEndsAt - now) / 1000)) },
        },
      );
}
