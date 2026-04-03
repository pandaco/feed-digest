import { Article } from './article';

/**
 * Input for the article enrichment process.
 */
export interface EnrichInput {
  title: string;
  /** Full content or excerpt if full content is unavailable */
  content: string;
  /** Flag indicating if the enrichment is based on the excerpt only */
  contentUnavailable: boolean;
  /** Human-readable name of the target language (e.g. 'French', 'English') */
  language: string;
  /** Maximum number of tags to generate. */
  maxTags: number;
  /** Free-text description of user interests for relevance scoring */
  userInterests?: string;
}

/**
 * Output of the article enrichment process.
 */
export interface EnrichOutput {
  /** 3-5 sentences summarizing the article in the target language */
  summary: string;
  /** Free tags reflecting the main topics in the target language */
  tags: string[];
  /** Relevance score (1-10) based on user interests */
  relevanceScore: number;
}

/**
 * Port for the Large Language Model (LLM) processing.
 * This interface isolates the domain from specific AI providers like Anthropic or Google.
 */
export interface LlmPort {
  /**
   * Enriches a single article with a summary, tags, and importance level.
   * 
   * @param input Data for enrichment.
   * @returns AI-generated summary, tags, and importance.
   */
  enrich(input: EnrichInput): Promise<EnrichOutput>;

  /**
   * Generates a global summary of all articles processed in a run.
   * Used to highlight trending topics and general sentiment.
   * 
   * @param articles List of articles processed in the run.
   * @param language Target language for the summary.
   * @returns A global summary of the run.
   */
  summarizeRun(articles: Article[], language: string): Promise<string>;

  /**
   * Generates a detailed HTML summary of inbox articles.
   * Highlights key themes, notable articles, and trends.
   *
   * @param articles List of inbox articles.
   * @param language Target language for the summary.
   * @returns An HTML-formatted summary.
   */
  summarizeInbox(articles: Article[], language: string): Promise<string>;
}
