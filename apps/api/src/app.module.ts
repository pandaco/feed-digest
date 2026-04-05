import 'reflect-metadata';
import {
  Module, NestModule, MiddlewareConsumer, RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createStorage, createTagPreference, createLlm } from '@feed-digest/adapters';
import { NoCacheInterceptor } from './interceptors/no-cache.interceptor';
import { AuthMiddleware } from './middleware/auth.middleware';
import { ConfigController } from './controllers/config.controller';
import { PreferencesController } from './controllers/preferences.controller';
import { InterestsController } from './controllers/interests.controller';
import { InboxController } from './controllers/inbox.controller';
import { SavedController } from './controllers/saved.controller';
import { ArticlesController } from './controllers/articles.controller';

@Module({
  controllers: [
    ConfigController,
    PreferencesController,
    InterestsController,
    InboxController,
    SavedController,
    ArticlesController,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: NoCacheInterceptor },
    { provide: 'STORAGE', useFactory: () => createStorage('API') },
    { provide: 'TAG_PREFERENCE', useFactory: () => createTagPreference() },
    { provide: 'LLM', useFactory: () => createLlm('API').llm },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // /api/config is public — auth applies to everything else under /api
    consumer
      .apply(AuthMiddleware)
      .exclude({ path: 'api/config', method: RequestMethod.GET })
      .forRoutes('api');
  }
}
