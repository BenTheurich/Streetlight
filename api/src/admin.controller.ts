import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';

// Controller-level path: /admin
@Controller('admin')
export class AdminController {
  // Protected endpoint: /admin/whoami
  @UseGuards(AuthGuard)
  @Get('whoami')
  whoami(@Req() req: any) {
    return { sub: req.user?.sub, email: req.user?.email };
  }

  // Unprotected ping (handy for quick checks): /admin/ping
  @Get('ping')
  ping() {
    return { ok: true, scope: 'admin' };
  }
}
