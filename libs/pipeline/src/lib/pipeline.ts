import pLimit from 'p-limit';
import {
  Article,
  LlmPort,
  NotifierPort,
  ScraperPort,
  SessionPort,
  StoragePort,
  TagPreferencePort,
  TelegramSession,
  normalizeTag,
  deduplicate,
  filterNoise,
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
  tagPreference?: TagPreferencePort;
}

const LANGUAGE_MAP: Record<string, string> = { fr: 'French', en: 'English' };

function computeImportance(
  tags: string[],
  tagOverrides: Record<string, string>,
  tagPrefs: Record<string, { selectionCount: number; presentedCount: number }>,
  threshold: number,
  minRuns: number,
): Article['importance'] {
  if (tags.length === 0) return 'medium';

  let hasAuto = false;
  let hasAccepted = false;
  let allFiltered = true;

  for (const tag of tags) {
    const key = normalizeTag(tag);
    const override = tagOverrides[key];

    if (override === 'auto') {
      hasAuto = true;
      allFiltered = false;
      continue;
    }

    if (override === 'filtered') {
      continue;
    }

    allFiltered = false;

    // Score-based: if the user frequently selects this tag, it's important
    const stats = tagPrefs[key];
    if (stats && stats.presentedCount >= minRuns) {
      const score = stats.selectionCount / stats.presentedCount;
      if (score >= threshold) hasAccepted = true;
    }
  }

  if (hasAuto) return 'high';
  if (allFiltered) return 'low';
  if (hasAccepted) return 'high';
  return 'medium';
}

interface TagPreferenceContext {
  overrides: Record<string, string>;
  tags: Record<string, { selectionCount: number; presentedCount: number }>;
  threshold: number;
  minRuns: number;
}

async function enrichAndSave(
  meta: import('@feed-digest/core').ArticleMetadata,
  index: number,
  total: number,
  options: RunPipelineOptions,
  languageName: string,
  runAt: string,
  minDelayMs: number,
  maxDelayMs: number,
  prefContext: TagPreferenceContext,
): Promise<Article | undefined> {
  const tag = `[${index + 1}/${total}]`;
  const jitter = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

  await new Promise(resolve => setTimeout(resolve, jitter));
  console.log(`[Pipeline] ${tag} Fetching content: ${meta.title} (delay: ${jitter}ms)`);

  const fetched = await options.scraper.fetchContent(meta.url);
  const fullContent = fetched.content;
  const contentUnavailable = !fullContent;
  const publishedAt = fetched.publishedAt || meta.publishedAt;

  console.log(`[Pipeline] ${tag} Enriching via ${options.llmProvider}...`);
  const userInterests = process.env['USER_INTERESTS'] || '';
  const enrichment = await options.llm.enrich({
    title: meta.title,
    content: fullContent || meta.excerpt,
    contentUnavailable,
    language: languageName,
    maxTags: options.maxTags ?? 3,
    userInterests: userInterests || undefined,
  });

  const importance = computeImportance(
    enrichment.tags,
    prefContext.overrides,
    prefContext.tags,
    prefContext.threshold,
    prefContext.minRuns,
  );

  const article: Article = {
    ...meta,
    ...enrichment,
    importance,
    publishedAt,
    runAt,
    contentUnavailable,
    llmProvider: options.llmProvider,
    summaryLanguage: options.summaryLang,
    isSaved: meta.isSaved,
    relevanceScore: enrichment.relevanceScore,
  };

  console.log(`[Pipeline] ${tag} Importance: ${importance} | Stored in Inbox: ${article.title}`);

  await options.storage.appendToAll([article]);
  await options.storage.appendToInbox([article]);

  return article;
}

export interface BuildNotificationDataOptions {
  articles: Article[];
  tagPreference?: TagPreferencePort;
  chatId?: string;
}

export async function buildNotificationData(options: BuildNotificationDataOptions) {
  const { articles, tagPreference, chatId } = options;
  const tagCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const sessionTags: TelegramSession['tags'] = {};
  const articleCache: TelegramSession['articles'] = {};
  const savedArticles: { title: string; url: string }[] = [];
  const preSelected: Record<string, boolean> = {};

  for (const article of articles) {
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

  // Compute pre-selection and filtering from learned preferences
  const threshold = parseFloat(process.env['TAG_PREFERENCE_THRESHOLD'] || '0.6');
  const minRuns = parseInt(process.env['TAG_PREFERENCE_MIN_RUNS'] || '3', 10);
  const filteredTags = new Set<string>();

  if (tagPreference && chatId) {
    const prefs = await tagPreference.get(chatId);
    if (prefs) {
      const overrides = prefs.tagOverrides ?? {};
      for (const tag of Object.keys(sessionTags)) {
        const override = overrides[normalizeTag(tag)];

        if (override === 'filtered') {
          filteredTags.add(tag);
          continue;
        }

        if (override === 'auto') {
          preSelected[tag] = true;
          sessionTags[tag].selected = true;
          continue;
        }

        // Default: threshold-based auto-selection
        const stats = prefs.tags[normalizeTag(tag)];
        if (stats && stats.presentedCount >= minRuns) {
          const score = stats.selectionCount / stats.presentedCount;
          if (score >= threshold) {
            preSelected[tag] = true;
            sessionTags[tag].selected = true;
          }
        }
      }
    }
  }

  // Build visible tag counts (excluding filtered tags)
  const visibleTagCounts: Record<string, number> = {};
  for (const [tag, count] of Object.entries(tagCounts)) {
    if (!filteredTags.has(tag)) {
      visibleTagCounts[tag] = count;
    }
  }

  // Sort: pre-selected first, then by frequency
  const tagOrder = Object.entries(visibleTagCounts)
    .sort((a, b) => {
      const aSelected = preSelected[a[0]] ? 1 : 0;
      const bSelected = preSelected[b[0]] ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      return b[1] - a[1];
    })
    .map(entry => entry[0]);

  const preSelectedCount = Object.keys(preSelected).length;

  return { tagCounts: visibleTagCounts, sourceCounts, sessionTags, articleCache, savedArticles, tagOrder, preSelected, preSelectedCount, filteredTags };
}

interface RunStats {
  articlesCollected: number;
  duplicatesRemoved: number;
  noiseFiltered: number;
  failedCount: number;
  llmCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
}

async function sendNotifications(
  options: RunPipelineOptions,
  articles: Article[],
  remaining: number,
  runAtDate: Date,
  stats: RunStats,
) {
  const sourceCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const a of articles) {
    sourceCounts[a.feedSource] = (sourceCounts[a.feedSource] || 0) + 1;
    for (const t of a.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  const runLabel = new Date().getHours() < 12 ? 'morning' : 'evening';

  const importanceCounts = { high: 0, medium: 0, low: 0 };
  let totalScore = 0;
  let scoreCount = 0;
  for (const a of articles) {
    importanceCounts[a.importance]++;
    if (a.relevanceScore) {
      totalScore += a.relevanceScore;
      scoreCount++;
    }
  }

  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  await options.notifier.sendRunSummary({
    runLabel,
    date: runAtDate.toLocaleString(),
    articlesProcessed: articles.length,
    articlesRemaining: remaining,
    tagCounts,
    llmProvider: options.llmProvider,
    summaryLanguage: options.summaryLang,
    durationMs: Date.now() - runAtDate.getTime(),
    articlesCollected: stats.articlesCollected,
    duplicatesRemoved: stats.duplicatesRemoved,
    noiseFiltered: stats.noiseFiltered,
    failedCount: stats.failedCount,
    importanceCounts,
    averageRelevanceScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 10) / 10 : undefined,
    topSources,
    llmCalls: stats.llmCalls,
    llmInputTokens: stats.llmInputTokens,
    llmOutputTokens: stats.llmOutputTokens,
  });
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
  const languageName = LANGUAGE_MAP[options.summaryLang] || options.summaryLang;

  try {
    console.log(`[Pipeline] Starting run at ${runAtDate.toLocaleString()} (limit: ${limit}, lang: ${options.summaryLang}, concurrency: ${concurrency})`);

    const { articles: rawMetadata, remaining } = await options.scraper.collect(limit);

    if (rawMetadata.length === 0) {
      console.log('[Pipeline] No unread articles found. Exiting.');
      return;
    }

    const { unique: dedupedMetadata, duplicates } = deduplicate(rawMetadata);
    if (duplicates.length > 0) {
      console.log(`[Pipeline] Deduplicated: ${duplicates.length} duplicate(s) removed, ${dedupedMetadata.length} unique articles to process.`);
    }

    const { kept: metadata, noise } = filterNoise(dedupedMetadata);
    if (noise.length > 0) {
      console.log(`[Pipeline] Auto-archived: ${noise.length} noise article(s) filtered (too short, ads, blacklisted).`);
    }

    console.log(`[Pipeline] Collected ${metadata.length} articles. Processing...`);

    // Load tag preferences once for importance computation
    const threshold = parseFloat(process.env['TAG_PREFERENCE_THRESHOLD'] || '0.6');
    const minRuns = parseInt(process.env['TAG_PREFERENCE_MIN_RUNS'] || '3', 10);
    const prefContext: TagPreferenceContext = { overrides: {}, tags: {}, threshold, minRuns };

    if (options.tagPreference && options.telegramChatId) {
      const prefs = await options.tagPreference.get(options.telegramChatId);
      if (prefs) {
        prefContext.overrides = prefs.tagOverrides ?? {};
        prefContext.tags = prefs.tags;
        console.log(`[Pipeline] Loaded tag preferences for importance (${Object.keys(prefContext.overrides).length} overrides, ${Object.keys(prefContext.tags).length} tags)`);
      }
    }

    const limitEnrich = pLimit(concurrency);
    const limitMarkRead = pLimit(1);

    const results = await Promise.all(metadata.map((meta, i) => limitEnrich(async () => {
      const tag = `[${i + 1}/${metadata.length}]`;
      try {
        const article = await enrichAndSave(meta, i, metadata.length, options, languageName, runAt, minDelayMs, maxDelayMs, prefContext);
        if (article) {
          await limitMarkRead(async () => {
            console.log(`[Pipeline] ${tag} Marking as read...`);
            await options.scraper.markAsRead(article.id, article.url);
          });
        }
        return article;
      } catch (error) {
        console.error(`[Pipeline] ${tag} Failed to process "${meta.title}":`, error);
        return undefined;
      }
    })));

    const enrichedArticles = results.filter((a): a is Article => a !== undefined);
    const failedCount = metadata.length - enrichedArticles.length;
    console.log(`[Pipeline] Finished processing. (Saved: ${enrichedArticles.length}, Failed: ${failedCount})`);

    const llmUsage = options.llm.getUsage();
    await sendNotifications(options, enrichedArticles, remaining, runAtDate, {
      articlesCollected: rawMetadata.length,
      duplicatesRemoved: duplicates.length,
      noiseFiltered: noise.length,
      failedCount,
      llmCalls: llmUsage.calls,
      llmInputTokens: llmUsage.inputTokens,
      llmOutputTokens: llmUsage.outputTokens,
    });

    console.log('[Pipeline] Run completed successfully.');
  } catch (error) {
    console.error('[Pipeline] Critical failure during run:', error);
    await options.notifier.sendError(
      error instanceof Error ? error.message : String(error),
      options.summaryLang,
    );
    throw error;
  } finally {
    await options.scraper.close();
  }
}
