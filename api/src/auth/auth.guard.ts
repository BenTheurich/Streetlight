import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const DISABLE = process.env.DISABLE_AUTH === 'true';
const ISSUER = process.env.CLERK_ISSUER!;
const AUD = process.env.CLERK_AUDIENCE!;
const JWKS = createRemoteJWKSet(new URL(process.env.CLERK_JWKS_URL!));

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (DISABLE) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = (req.headers as any)['authorization'] ?? (req.headers as any)['Authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    const token = raw.slice(7);
    try {
      const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUD });
      (req as any).user = { sub: payload.sub, email: (payload as any).email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
