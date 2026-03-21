import { TelegramSession } from './session';

/**
 * Port for the session storage (DynamoDB).
 * This interface isolates the domain from specific database implementations.
 */
export interface SessionPort {
  /**
   * Persists a Telegram user session with a TTL.
   * 
   * @param session The session to save.
   */
  save(session: TelegramSession): Promise<void>;

  /**
   * Retrieves a session by chatId.
   * 
   * @param chatId The chat ID of the user.
   * @returns The session or null if not found or expired.
   */
  get(chatId: string): Promise<TelegramSession | null>;

  /**
   * Deletes a session after the user has validated their selection.
   * 
   * @param chatId The chat ID of the user.
   */
  delete(chatId: string): Promise<void>;
}
