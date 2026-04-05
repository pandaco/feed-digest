import { ApplicationConfig, provideBrowserGlobalErrorListeners, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { appRoutes } from './app.routes';
import { authInterceptor } from './shared/auth.interceptor';
import { setDateFormat } from './shared/format';

function loadConfig(http: HttpClient): () => Promise<void> {
  return () =>
    http.get<{ dateFormat?: string }>('/api/config').toPromise()
      .then(config => {
        if (config?.dateFormat) setDateFormat(config.dateFormat);
      })
      .catch(() => {
        // Keep default format if config endpoint is unavailable
      });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: loadConfig,
      deps: [HttpClient],
      multi: true,
    },
  ],
};
