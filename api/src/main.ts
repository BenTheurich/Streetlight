// api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}
bootstrap();