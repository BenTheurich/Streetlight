import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

@Injectable()
export class AuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.DISABLE_AUTH === 'true') {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.substring('Bearer '.length);

    const jwksUrl = process.env.CLERK_JWKS_URL;
    const issuer = process.env.CLERK_ISSUER;
    const audience = process.env.CLERK_AUDIENCE;

    if (!jwksUrl || !issuer || !audience) {
      throw new UnauthorizedException('Auth configuration missing');
    }

    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer,
        audience,
      });
      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
