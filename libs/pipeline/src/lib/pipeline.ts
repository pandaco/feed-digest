import pLimit from 'p-limit';
import { 
  Article, 
  LlmPort, 
  NotifierPort, 
  ScraperPort, 
  SessionPort, 
  StoragePort, 
  TelegramSession 
} from '@feed-digest/core';

export interface RunPipelineOptions {
  scraper: ScraperPort;
  llm: LlmPort;
  storage: StoragePort;
  notifier: NotifierPort;
  session: SessionPort;
  summaryLang: string;
  telegramChatId: string;
  llmProvider: 'claude' | 'gemini';
  limit?: number;
  maxTags?: number;
  concurrency?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Main orchestration function for the InoReader digest pipeline.
 * Coordinates scraping, AI enrichment, storage, and notification.
 */
export async function runPipeline(options: RunPipelineOptions): Promise<void> {
  const limit = options.limit ?? 150;
  const concurrency = options.concurrency ?? 5;
  const minDelayMs = options.minDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 3000;
  const runAtDate = new Date();
  const runAt = runAtDate.toISOString();

  // 1. Resolve language name for LLM prompt
  const languageMap: Record<string, string> = {
    fr: 'French',
    en: 'English'
  };
  const languageName = languageMap[options.summaryLang] || options.summaryLang;

  try {
    console.log(`[Pipeline] Starting run at ${runAtDate.toLocaleString()} (limit: ${limit}, lang: ${options.summaryLang}, concurrency: ${concurrency})`);

    // 2. Collect articles from InoReader
    const collectResult = await options.scraper.collect(limit);
    const { articles: metadata, remaining } = collectResult;

    if (metadata.length === 0) {
      console.log('[Pipeline] No unread articles found. Exiting.');
      return;
    }

    console.log(`[Pipeline] Collected ${metadata.length} articles. Processing...`);

    // 3. Process, Enrich, Save and Mark as read with concurrency control
    const limitEnrich = pLimit(concurrency);
    const limitMarkRead = pLimit(1);

    console.log(`[Pipeline] Processing ${metadata.length} articles in parallel (concurrency: ${concurrency})...`);

    const results = await Promise.all(metadata.map((meta, i) => limitEnrich(async () => {
      // Stagger tasks based on index to avoid initial burst and 429 errors
      // minDelayMs: the rhythm (increment per article)
      // maxDelayMs: the noise (maximum random jitter added)
      const baseStagger = i * minDelayMs;
      const jitter = Math.floor(Math.random() * (maxDelayMs + 1));
      const totalWait = baseStagger + jitter;

      await new Promise(resolve => setTimeout(resolve, totalWait));

      console.log(`[Pipeline] [${i + 1}/${metadata.length}] Processing: ${meta.title} (wait: ${totalWait}ms)`);      try {
        // 3.1 Fetch full content
        const fullContent = await options.scraper.fetchContent(meta.url);
        const contentUnavailable = !fullContent;
        const contentToEnrich = fullContent || meta.excerpt;

        // 3.2 Call LLM for enrichment
        const enrichment = await options.llm.enrich({
          title: meta.title,
          content: contentToEnrich,
          contentUnavailable,
          language: languageName,
          maxTags: options.maxTags ?? 3,
        });

        const article: Article = {
          ...meta,
          ...enrichment,
          runAt,
          contentUnavailable,
          llmProvider: options.llmProvider,
          summaryLanguage: options.summaryLang,
          isSaved: meta.isSaved,
        };

        // 3.3 Save to Storage (Immediate storage)
        await options.storage.appendToAll([article]);
        if (article.isSaved) {
          await options.storage.appendToSaved([article]);
          console.log(`[Pipeline] Article saved/starred -> Saved tab (skipping Inbox): ${article.title}`);
        } else {
          await options.storage.appendToInbox([article]);
        }

        // 3.4 Mark as read in InoReader (Queued sequentially via mutex)
        await limitMarkRead(() => options.scraper.markAsRead(article.id, article.url));

        return article;
      } catch (error) {
        console.error(`[Pipeline] Failed to process article "${meta.title}":`, error);
        return undefined;
      }
    })));

    const enrichedArticles = results.filter((a): a is Article => a !== undefined);
    const processedSuccessfully = enrichedArticles.length;
    const processedFailed = metadata.length - processedSuccessfully;

    console.log(`[Pipeline] Finished processing articles. (Saved: ${processedSuccessfully}, Failed: ${processedFailed})`);

    // 4. Global Synthesis & Notification
    console.log('[Pipeline] Generating global run synthesis...');
    const runSynthesis = await options.llm.summarizeRun(enrichedArticles, languageName);

    console.log('[Pipeline] Preparing Telegram notification...');
    const tagCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const sessionTags: TelegramSession['tags'] = {};
    const articleCache: TelegramSession['articles'] = {};
    const savedArticles: { title: string; url: string }[] = [];

    for (const article of enrichedArticles) {
      articleCache[article.id] = { title: article.title, url: article.url };
      sourceCounts[article.feedSource] = (sourceCounts[article.feedSource] || 0) + 1;
      if (article.isSaved) {
        savedArticles.push({ title: article.title, url: article.url });
      }
      for (const tag of article.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        if (!sessionTags[tag]) {
          sessionTags[tag] = { selected: false, articleIds: [] };
        }
        sessionTags[tag].articleIds.push(article.id);
      }
    }

    const runLabel = new Date().getHours() < 12 ? 'morning' : 'evening';
    const tagOrder = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    // Message 1: Run stats
    await options.notifier.sendRunSummary({
      runLabel,
      date: runAtDate.toLocaleString(),
      articlesProcessed: enrichedArticles.length,
      articlesRemaining: remaining,
      tagCounts,
      llmProvider: options.llmProvider,
      summaryLanguage: options.summaryLang,
      durationMs: Date.now() - runAtDate.getTime()
    });

    // Message 2: Source stats
    await options.notifier.sendSourceStats(sourceCounts, options.summaryLang);

    // Message 3: Trending topics synthesis
    if (runSynthesis) {
      await options.notifier.sendSynthesis(runSynthesis, options.summaryLang);
    }

    // Message 4: Tag selection with buttons
    const messageId = await options.notifier.sendTagSelection(tagCounts, options.summaryLang);

    // Message 5: Saved articles (if any)
    if (savedArticles.length > 0) {
      await options.notifier.sendSavedArticles(savedArticles, options.summaryLang);
    }

    // 5. Save Session for Telegram callbacks
    await options.session.save({
      chatId: options.telegramChatId,
      messageId,
      runAt,
      tags: sessionTags,
      tagOrder,
      articles: articleCache,
      ttl: Math.floor(Date.now() / 1000) + 43200 // 12h
    });

    console.log('[Pipeline] Run completed successfully.');

  } catch (error) {
    console.error('[Pipeline] Critical failure during run:', error);
    await options.notifier.sendError(
      error instanceof Error ? error.message : String(error), 
      options.summaryLang
    );
    throw error;
  } finally {
    await options.scraper.close();
  }
}
