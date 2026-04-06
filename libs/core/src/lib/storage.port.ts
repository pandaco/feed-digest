import { Article } from './article';

/**
 * Port for the storage system (Notion, Google Sheets, DynamoDB).
 */
export interface StoragePort {
  /**
   * Append articles to the inbox.
   */
  appendToInbox(articles: Article[]): Promise<void>;

  /**
   * Get all articles from the inbox.
   */
  getFromInbox(): Promise<Article[]>;

  /**
   * Delete articles from the inbox.
   * Usually called after user filtering in Telegram.
   */
  deleteFromInbox(articleIds: string[]): Promise<void>;

  /**
   * Get articles from inbox that don't have tags yet.
   */
  getUntaggedArticles(): Promise<Article[]>;

  /**
   * Append articles to the main list (all processed articles).
   */
  appendToAll(articles: Article[]): Promise<void>;

  /**
   * Update an article's metadata (tags, summary, importance, snooze).
   * Should update in both Inbox and All collections if article exists in both.
   */
  updateArticle(article: Article): Promise<void>;

  /**
   * Append articles to saved articles.
   */
  appendToSaved(articles: Article[]): Promise<void>;

  /**
   * Get all saved articles.
   */
  getFromSaved(): Promise<Article[]>;

  /**
   * Delete articles from saved articles.
   */
  deleteFromSaved(articleIds: string[]): Promise<void>;

  /**
   * Delete articles older than X days from the ALL collection.
   * Returns the number of articles purged.
   */
  purgeExpiredArticles(days: number): Promise<number>;
}
