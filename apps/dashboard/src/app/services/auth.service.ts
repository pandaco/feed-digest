import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  apiToken = signal(sessionStorage.getItem('apiToken') || '');
  chatId = signal(sessionStorage.getItem('chatId') || '');

  setApiToken(token: string): void {
    this.apiToken.set(token);
    sessionStorage.setItem('apiToken', token);
  }

  setChatId(id: string): void {
    this.chatId.set(id);
    sessionStorage.setItem('chatId', id);
  }
}
