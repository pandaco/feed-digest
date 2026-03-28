import { HttpHeaders } from '@angular/common/http';

export function apiHeaders(): HttpHeaders {
  const token = localStorage.getItem('apiToken') || '';
  return new HttpHeaders({
    'x-telegram-bot-api-secret-token': token,
    'Content-Type': 'application/json',
  });
}
