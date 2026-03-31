import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = sessionStorage.getItem('apiToken') || '';

  if (token) {
    req = req.clone({
      setHeaders: {
        'x-telegram-bot-api-secret-token': token,
        'Content-Type': 'application/json',
      },
    });
  }

  return next(req);
};
