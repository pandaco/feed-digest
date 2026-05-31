/**
 * Metadata for an article extracted from InoReader.
 */
export interface ArticleMetadata {
  /** Unique identifier for the article from InoReader (e.g. data-aid). */
  id: string;
  /** Article title */
  title: string;
  /** Source URL */
  url: string;
  /** RSS feed name (e.g. "TechCrunch") */
  feedSource: string;
  /** Publication date (ISO 8601) */
  publishedAt: string;
  /** Short excerpt provided by InoReader */
  excerpt: string;
  /** Whether the article is marked as saved/starred in InoReader */
  isSaved: boolean;
  /** Scraper source identifier (e.g. 'inoreader', 'inoreader-saved', 'feedly') */
  scraperSource: string;
}

/**
 * Result of the collection process.
 */
export interface CollectResult {
  /** The batch of articles to process (limited to N articles) */
  articles: ArticleMetadata[];
  /** Total number of unread articles available in InoReader */
  totalUnread: number;
  /** Number of unread articles remaining for future runs */
  remaining: number;
}

export interface FetchContentResult {
  content: string | null;
  publishedAt: string | null;
}

/**
 * Outcome of a markAsRead call. `ok` is true when the article was located
 * and the read/unstar shortcut was sent; false when the article could not
 * be found in the UI even after scrolling (no exception thrown). `scrolls`
 * reports how many scroll bursts were required to locate it — useful to
 * detect when the lazy-load is the bottleneck.
 */
export interface MarkAsReadResult {
  ok: boolean;
  scrolls: number;
}

/**
 * Port for the InoReader scraper.
 * This interface isolates the domain from the underlying scraping implementation (Playwright).
 */
export interface ScraperPort {
  /**
   * Navigates to InoReader, authenticates if necessary, and collects unread articles.
   * Articles must be returned in FIFO order (oldest first).
   * 
   * @param limit The maximum number of articles to collect in this run.
   */
  collect(limit: number): Promise<CollectResult>;

  /**
   * Navigates to the source URL and extracts the main content of the article.
   *
   * @param url The source URL of the article.
   * @returns The full content and publication date, or null if inaccessible.
   */
  fetchContent(url: string): Promise<FetchContentResult>;

  /**
   * Marks a specific article as read on InoReader.
   *
   * @param articleId The unique identifier of the article.
   * @param url The URL of the article (used to find it in the UI).
   * @returns The outcome and how many scrolls were needed. Never throws
   *          for a "not found" case; only for unexpected crashes.
   */
  markAsRead(articleId: string, url: string): Promise<MarkAsReadResult>;

  /**
   * Closes the scraper session and releases browser resources.
   */
  close(): Promise<void>;
}
