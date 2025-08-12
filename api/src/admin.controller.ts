import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';

@Controller('admin')
export class AdminController {
  @UseGuards(AuthGuard)
  @Get('secret')
  secret() {
    return { ok: true, message: 'Authorized' };
  }
}
