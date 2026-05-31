import pLimit from 'p-limit';
import {
  Article,
  LlmPort,
  LlmProvider,
  NotifierPort,
  ScraperPort,
  StoragePort,
  TagPreferencePort,
  normalizeTag,
  deduplicate,
  filterNoise,
} from '@feed-digest/core';

export interface RunPipelineOptions {
  scraper: ScraperPort;
  llm: LlmPort;
  storage: StoragePort;
  notifier: NotifierPort;
  summaryLang: string;
  telegramChatId: string;
  llmProvider: LlmProvider;
  limit?: number;
  maxTags?: number;
  concurrency?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  tagPreference?: TagPreferencePort;
}

const LANGUAGE_MAP: Record<string, string> = { fr: 'French', en: 'English' };

// Thresholds for relevance-score-based importance
const RELEVANCE_HIGH = 7;
const RELEVANCE_LOW  = 3;

function computeImportance(
  tags: string[],
  tagOverrides: Record<string, string>,
  tagPrefs: Record<string, { selectionCount: number; presentedCount: number }>,
  threshold: number,
  minRuns: number,
  relevanceScore?: number,
): Article['importance'] {
  let hasAuto = false;
  let hasAccepted = false;
  let allFiltered = tags.length > 0;

  for (const tag of tags) {
    const key = normalizeTag(tag);
    const override = tagOverrides[key];

    if (override === 'auto') { hasAuto = true; allFiltered = false; continue; }
    if (override === 'filtered') { continue; }

    allFiltered = false;

    const stats = tagPrefs[key];
    if (stats && stats.presentedCount >= minRuns) {
      if (stats.selectionCount / stats.presentedCount >= threshold) hasAccepted = true;
    }
  }

  // Manual overrides — absolute priority
  if (hasAuto) return 'high';
  if (allFiltered) return 'low';

  // Relevance score — primary signal when available
  if (relevanceScore !== undefined) {
    if (relevanceScore >= RELEVANCE_HIGH) return 'high';
    if (hasAccepted) return 'high';
    if (relevanceScore <= RELEVANCE_LOW) return 'low';
    return 'medium';
  }

  // Fallback: tag preference only (no USER_INTERESTS configured)
  if (hasAccepted) return 'high';
  return 'medium';
}

interface TagPreferenceContext {
  overrides: Record<string, string>;
  tags: Record<string, { selectionCount: number; presentedCount: number }>;
  threshold: number;
  minRuns: number;
}

interface ArticleTimings {
  fetchMs: number;
  enrichMs: number;
  storeMs: number;
  jitterMs: number;
}

interface EnrichResult {
  article: Article;
  timings: ArticleTimings;
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
): Promise<EnrichResult | undefined> {
  const tag = `[${index + 1}/${total}]`;
  // Ollama runs locally with no rate limit, so skip the anti-throttling jitter.
  const jitterMs = options.llmProvider === 'ollama'
    ? 0
    : Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

  if (jitterMs > 0) {
    await new Promise(resolve => setTimeout(resolve, jitterMs));
  }
  console.log(`[Pipeline] ${tag} Fetching content: ${meta.title}${jitterMs > 0 ? ` (delay: ${jitterMs}ms)` : ''}`);

  const fetchStart = Date.now();
  const fetched = await options.scraper.fetchContent(meta.url);
  const fetchMs = Date.now() - fetchStart;
  const fullContent = fetched.content;
  const contentUnavailable = !fullContent;
  const publishedAt = fetched.publishedAt || meta.publishedAt;

  console.log(`[Pipeline] ${tag} Enriching via ${options.llmProvider}...`);
  const enrichStart = Date.now();
  const userInterests = process.env['USER_INTERESTS'] || '';
  const enrichment = await options.llm.enrich({
    title: meta.title,
    content: fullContent || meta.excerpt,
    contentUnavailable,
    language: languageName,
    maxTags: options.maxTags ?? 3,
    userInterests: userInterests || undefined,
  });
  const enrichMs = Date.now() - enrichStart;

  const importance = computeImportance(
    enrichment.tags,
    prefContext.overrides,
    prefContext.tags,
    prefContext.threshold,
    prefContext.minRuns,
    enrichment.relevanceScore,
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

  const storeStart = Date.now();
  await Promise.all([
    options.storage.appendToAll([article]),
    options.storage.appendToInbox([article]),
  ]);
  const storeMs = Date.now() - storeStart;

  const totalMs = fetchMs + enrichMs + storeMs;
  console.log(`[Pipeline] ${tag} ${importance.toUpperCase()} | ${totalMs}ms (fetch ${fetchMs} / enrich ${enrichMs} / store ${storeMs}) | ${article.title}`);

  return { article, timings: { fetchMs, enrichMs, storeMs, jitterMs } };
}

export interface BuildNotificationDataOptions {
  articles: Article[];
}

export function buildNotificationData(options: BuildNotificationDataOptions): { tagCounts: Record<string, number>; sourceCounts: Record<string, number> } {
  const { articles } = options;
  const tagCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};

  for (const article of articles) {
    sourceCounts[article.feedSource] = (sourceCounts[article.feedSource] || 0) + 1;
    for (const tag of article.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  return { tagCounts, sourceCounts };
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
    date: runAtDate.toLocaleDateString('fr-FR') + ', ' + runAtDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function logPerformanceSummary(
  successful: EnrichResult[],
  enrichTotalMs: number,
  markTotalMs: number,
  concurrency: number,
  llmProvider: LlmProvider,
): void {
  if (successful.length === 0) {
    console.log('[Pipeline] No articles processed — skipping perf summary.');
    return;
  }

  const fetchTimes = successful.map(r => r.timings.fetchMs).sort((a, b) => a - b);
  const enrichTimes = successful.map(r => r.timings.enrichMs).sort((a, b) => a - b);
  const storeTimes = successful.map(r => r.timings.storeMs).sort((a, b) => a - b);
  const totalTimes = successful
    .map(r => r.timings.fetchMs + r.timings.enrichMs + r.timings.storeMs + r.timings.jitterMs)
    .sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const mean = (arr: number[]) => Math.round(sum(arr) / arr.length);
  const fmtMs = (ms: number) => `${ms.toLocaleString()}ms`;
  const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  const totalWallMs = enrichTotalMs + markTotalMs;
  const cumulativeWorkMs = sum(totalTimes);
  const parallelismRatio = (cumulativeWorkMs / enrichTotalMs).toFixed(2);

  console.log('');
  console.log('[Pipeline] ┌─ Performance summary ────────────────────────────────');
  console.log(`[Pipeline] │ Articles processed : ${successful.length}`);
  console.log(`[Pipeline] │ Wall clock         : ${fmtSec(totalWallMs)} (enrich ${fmtSec(enrichTotalMs)} + markAsRead ${fmtSec(markTotalMs)})`);
  console.log(`[Pipeline] │ LLM provider       : ${llmProvider}  (concurrency=${concurrency})`);
  console.log(`[Pipeline] │ Throughput         : ${(successful.length / (totalWallMs / 1000)).toFixed(2)} art/s  (≈ ${fmtMs(Math.round(totalWallMs / successful.length))} per article wall time)`);
  console.log(`[Pipeline] │ Parallelism factor : ${parallelismRatio}× (cumulative work ${fmtSec(cumulativeWorkMs)} vs wall ${fmtSec(enrichTotalMs)})`);
  console.log('[Pipeline] │');
  console.log('[Pipeline] │ Per-article timings  avg     p50     p95     max');
  console.log(`[Pipeline] │   fetch content     ${fmtMs(mean(fetchTimes)).padStart(7)} ${fmtMs(percentile(fetchTimes, 0.5)).padStart(7)} ${fmtMs(percentile(fetchTimes, 0.95)).padStart(7)} ${fmtMs(fetchTimes[fetchTimes.length - 1]).padStart(7)}`);
  console.log(`[Pipeline] │   enrich (LLM)      ${fmtMs(mean(enrichTimes)).padStart(7)} ${fmtMs(percentile(enrichTimes, 0.5)).padStart(7)} ${fmtMs(percentile(enrichTimes, 0.95)).padStart(7)} ${fmtMs(enrichTimes[enrichTimes.length - 1]).padStart(7)}`);
  console.log(`[Pipeline] │   storage writes    ${fmtMs(mean(storeTimes)).padStart(7)} ${fmtMs(percentile(storeTimes, 0.5)).padStart(7)} ${fmtMs(percentile(storeTimes, 0.95)).padStart(7)} ${fmtMs(storeTimes[storeTimes.length - 1]).padStart(7)}`);
  console.log('[Pipeline] └──────────────────────────────────────────────────────');
  console.log('');
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
    // markAsRead operates on a single shared Inoreader page, so it stays
    // serialized inside the scraper. We fire-and-forget here so the enrich
    // loop is not blocked waiting for mark-as-read between articles.
    const limitMarkRead = pLimit(1);
    const skipMarkAsRead = process.env['SKIP_MARK_AS_READ'] === 'true';
    if (skipMarkAsRead) {
      console.log('[Pipeline] SKIP_MARK_AS_READ=true → articles will stay unread/starred on Inoreader.');
    }
    const markPromises: Promise<void>[] = [];

    const enrichStart = Date.now();
    const results = await Promise.all(metadata.map((meta, i) => limitEnrich(async () => {
      const tag = `[${i + 1}/${metadata.length}]`;
      try {
        const result = await enrichAndSave(meta, i, metadata.length, options, languageName, runAt, minDelayMs, maxDelayMs, prefContext);
        if (result && !skipMarkAsRead) {
          markPromises.push(limitMarkRead(async () => {
            console.log(`[Pipeline] ${tag} Marking as read (async)...`);
            await options.scraper.markAsRead(result.article.id, result.article.url);
          }));
        }
        return result;
      } catch (error) {
        console.error(`[Pipeline] ${tag} Failed to process "${meta.title}":`, error);
        return undefined;
      }
    })));
    const enrichTotalMs = Date.now() - enrichStart;

    const successful = results.filter((r): r is EnrichResult => r !== undefined);
    const enrichedArticles = successful.map(r => r.article);
    const failedCount = metadata.length - enrichedArticles.length;
    console.log(`[Pipeline] Finished enrich phase in ${enrichTotalMs}ms (Saved: ${enrichedArticles.length}, Failed: ${failedCount}).`);

    let markTotalMs = 0;
    if (markPromises.length > 0) {
      console.log(`[Pipeline] Waiting for ${markPromises.length} background mark-as-read to finish...`);
      const markStart = Date.now();
      await Promise.all(markPromises);
      markTotalMs = Date.now() - markStart;
      console.log(`[Pipeline] Mark-as-read drained in ${markTotalMs}ms.`);
    }

    logPerformanceSummary(successful, enrichTotalMs, markTotalMs, concurrency, options.llmProvider);

    // Automatic purge of expired articles in ALL collection
    const retentionDays = parseInt(process.env['RETENTION_DAYS_ALL'] || '30', 10);
    try {
      const purgedCount = await options.storage.purgeExpiredArticles(retentionDays);
      if (purgedCount > 0) {
        console.log(`[Pipeline] Automatically purged ${purgedCount} expired articles from ALL collection.`);
      }
    } catch (purgeError) {
      console.error('[Pipeline] Failed to purge expired articles:', purgeError);
    }

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
