import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AdminController } from './admin.controller';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [],
  controllers: [AppController, AdminController],
  providers: [AuthGuard],
})
export class AppModule {}
