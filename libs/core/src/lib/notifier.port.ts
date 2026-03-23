/**
 * Metadata for a pipeline run summary.
 */
export interface RunSummary {
  /** Label for the run: morning (07:00) or evening (19:00) */
  runLabel: 'morning' | 'evening';
  /** Run date (formatted for the user) */
  date: string;
  /** Number of articles processed in this run */
  articlesProcessed: number;
  /** Number of unread articles waiting in InoReader */
  articlesRemaining: number;
  /** Article count per detected tag */
  tagCounts: Record<string, number>;
  /** The AI provider used for the run */
  llmProvider: 'claude' | 'gemini';
  /** Target language code (e.g. 'fr', 'en') */
  summaryLanguage: string;
  /** Duration of the run in milliseconds */
  durationMs?: number;
}

/**
 * Port for the notification system (Telegram).
 * This interface isolates the domain from specific messaging SDKs.
 */
export interface NotifierPort {
  /**
   * Sends the run stats message (date, count, LLM, lang, duration, tag count).
   */
  sendRunSummary(summary: RunSummary): Promise<void>;

  /**
   * Sends stats per RSS source.
   */
  sendSourceStats(sourceCounts: Record<string, number>, language: string): Promise<void>;

  /**
   * Sends the AI-generated trending topics synthesis.
   */
  sendSynthesis(synthesis: string, language: string): Promise<void>;

  /**
   * Sends the tag selection message with inline keyboard buttons.
   * @returns The unique ID of the sent message (for callback handling).
   */
  sendTagSelection(tagCounts: Record<string, number>, language: string, preSelected?: Record<string, boolean>): Promise<string>;

  /**
   * Updates the inline keyboard buttons of an existing tag selection message.
   */
  updateButtons(messageId: string, tags: Record<string, boolean>, tagOrder?: string[], tagCounts?: Record<string, number>): Promise<void>;

  /**
   * Sends a final confirmation message after the user validates their selection.
   */
  sendConfirmation(keptNumber: number, removedNumber: number, language: string): Promise<void>;

  /**
   * Sends a list of articles associated with a specific tag.
   */
  sendTagArticles(tagName: string, articles: { title: string; url: string }[], language: string): Promise<void>;

  /**
   * Sends a list of saved/starred articles.
   */
  sendSavedArticles(articles: { title: string; url: string }[], language: string): Promise<void>;

  /**
   * Sends an error alert message to the user.
   */
  sendError(message: string, language: string): Promise<void>;
}
