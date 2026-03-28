import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  apiToken = signal(localStorage.getItem('apiToken') || '');
  chatId = signal(localStorage.getItem('chatId') || '');

  setApiToken(token: string): void {
    this.apiToken.set(token);
    localStorage.setItem('apiToken', token);
  }

  setChatId(id: string): void {
    this.chatId.set(id);
    localStorage.setItem('chatId', id);
  }
}
