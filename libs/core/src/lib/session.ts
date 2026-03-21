/**
 * Domain entity for a Telegram user session.
 * Used to track tag selection and confirmation status after a run.
 */
export interface TelegramSession {
  /** The chat ID of the user (primary key) */
  chatId: string;
  /** The ID of the recap message sent by the bot */
  messageId: string;
  /** ISO 8601 timestamp of when the run occurred */
  runAt: string;
  /** State of each tag for the current session */
  tags: {
    [tagName: string]: {
      /** Whether the tag is currently selected by the user */
      selected: boolean;
      /** List of article IDs associated with this tag */
      articleIds: string[];
    };
  };
  /** Preserve the sorting of tags (usually by occurrence count) */
  tagOrder?: string[];
  /** Cache of article details to avoid re-fetching storage during session */
  articles?: {
    [id: string]: {
      title: string;
      url: string;
    };
  };
  /** Unix timestamp (seconds) for DynamoDB TTL (12h expiration) */
  ttl: number;
}
