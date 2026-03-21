import { Article } from './article';

/**
 * Port for persistent storage of articles.
 * This interface isolates the domain from specific storage implementations (e.g., Google Sheets).
 */
export interface StoragePort {
  /**
   * Appends newly enriched articles to the Inbox tab.
   * 
   * @param articles List of articles to append.
   */
  appendToInbox(articles: Article[]): Promise<void>;

  /**
   * Appends all processed articles to the permanent history (All tab).
   * 
   * @param articles List of articles to append.
   */
  appendToAll(articles: Article[]): Promise<void>;

  /**
   * Removes specific articles from the Inbox tab.
   * Usually called after user filtering in Telegram.
   * 
   * @param articleIds List of article IDs to remove.
   */
  deleteFromInbox(articleIds: string[]): Promise<void>;

  /**
   * Retrieves all articles currently present in the Inbox tab.
   *
   * @returns List of articles from the Inbox.
   */
  getFromInbox(): Promise<Article[]>;

  /**
   * Retrieves all articles from the Inbox that have no tags.
   *
   * @returns List of untagged articles from the Inbox.
   */
  getUntaggedArticles(): Promise<Article[]>;

  /**
   * Appends saved/starred articles to the Saved tab.
   *
   * @param articles List of saved articles to append.
   */
  appendToSaved(articles: Article[]): Promise<void>;

  /**
   * Updates an existing article in the storage (Inbox and All tabs).
   * Matches by article ID.
   * 
   * @param article The updated article data.
   */
  updateArticle(article: Article): Promise<void>;
}
