import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TelegramSession, SessionPort } from '@feed-digest/core';

export class FileSessionAdapter implements SessionPort {
  private readonly filePath: string;

  constructor(sessionDir: string = process.cwd()) {
    this.filePath = join(sessionDir, 'session-store.json');
  }

  private readStore(): Record<string, TelegramSession> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private writeStore(store: Record<string, TelegramSession>): void {
    writeFileSync(this.filePath, JSON.stringify(store, null, 2));
  }

  async save(session: TelegramSession): Promise<void> {
    const store = this.readStore();
    store[session.chatId] = session;
    this.writeStore(store);
    console.log(`[FileSessionAdapter] Session saved locally for chatId: ${session.chatId}`);
  }

  async get(chatId: string): Promise<TelegramSession | null> {
    const store = this.readStore();
    const session = store[chatId];
    if (!session) return null;

    if (session.ttl < Math.floor(Date.now() / 1000)) {
      console.log(`[FileSessionAdapter] Local session expired for chatId: ${chatId}`);
      delete store[chatId];
      this.writeStore(store);
      return null;
    }

    return session;
  }

  async delete(chatId: string): Promise<void> {
    const store = this.readStore();
    delete store[chatId];
    this.writeStore(store);
    console.log(`[FileSessionAdapter] Local session deleted for chatId: ${chatId}`);
  }
}
