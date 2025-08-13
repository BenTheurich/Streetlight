import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';

// All routes under /admin
@Controller('admin')
export class AdminController {
  @Get('ping')               // GET /admin/ping  (unprotected)
  ping() {
    return { ok: true, scope: 'admin' };
  }

  @UseGuards(AuthGuard)      // GET /admin/whoami (protected)
  @Get('whoami')
  whoami(@Req() req: any) {
    return { sub: req.user?.sub, email: req.user?.email };
  }
}
