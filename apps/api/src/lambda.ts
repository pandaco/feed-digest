import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import serverlessHttp from 'serverless-http';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

type ServerlessHandler = (event: APIGatewayProxyEventV2, context: Context) => Promise<unknown>;

let cachedHandler: ServerlessHandler | null = null;

async function bootstrap(): Promise<ServerlessHandler> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  return serverlessHttp(app.getHttpAdapter().getInstance()) as ServerlessHandler;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<unknown> => {
  if (!cachedHandler) {
    cachedHandler = await bootstrap();
  }
  return cachedHandler(event, context);
};
