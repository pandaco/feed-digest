/**
 * Core Domain Article Entity
 */
export interface Article {
  /** SHA-256 of the article URL */
  id: string;
  /** ISO 8601 timestamp of when the article was processed */
  runAt: string;
  /** ISO 8601 timestamp of when the article was published */
  publishedAt: string;
  /** Name of the RSS feed source */
  feedSource: string;
  /** Title of the article */
  title: string;
  /** Original URL of the article */
  url: string;
  /** List of extracted/generated tags (max 3) */
  tags: string[];
  /** LLM-generated summary (3-5 sentences) */
  summary: string;
  /** Calculated importance level */
  importance: 'high' | 'medium' | 'low';
  /** Flag indicating if the full content was accessible */
  contentUnavailable: boolean;
  /** LLM provider used for enrichment */
  llmProvider: 'claude' | 'gemini';
  /** Language used for the summary and tags */
  summaryLanguage: string;
  /** Whether the article was marked as saved/starred in InoReader */
  isSaved: boolean;
  /** Scraper source that collected this article (e.g. 'inoreader', 'inoreader-saved', 'feedly') */
  scraperSource: string;
}