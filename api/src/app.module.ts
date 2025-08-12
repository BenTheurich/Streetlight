import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [],
  controllers: [AppController, AdminController],
  providers: [],
})
export class AppModule {}
