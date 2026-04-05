import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({
    origin: '*',
    methods: 'GET,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,x-telegram-bot-api-secret-token',
  });
  const port = parseInt(process.env['API_PORT'] || '3333', 10);
  await app.listen(port);
  console.log(`[API] Dashboard API running on http://localhost:${port}`);
}

bootstrap().catch(console.error);
