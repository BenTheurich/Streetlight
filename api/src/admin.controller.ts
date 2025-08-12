import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';

@Controller('admin')
@UseGuards(AuthGuard)
export class AdminController {
  @Get('whoami')
  whoami(@Req() req: any) {
    return { sub: req.user?.sub, email: req.user?.email };
  }
}
