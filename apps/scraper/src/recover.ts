import * as dotenv from 'dotenv';
import { TelegramAdapter, createStorage, createLlm, createSession } from '@feed-digest/adapters';
import { buildNotificationData } from '@feed-digest/pipeline';

dotenv.config();

const LANGUAGE_MAP: Record<string, string> = { fr: 'French', en: 'English' };

async function reEnrichUntagged(
  storage: ReturnType<typeof createStorage>,
  llm: ReturnType<typeof createLlm>['llm'],
  languageName: string,
) {
  console.log('[Recover] Checking for untagged articles in Inbox...');
  const untagged = await storage.getUntaggedArticles();

  if (untagged.length === 0) {
    console.log('[Recover] No untagged articles found.');
    return;
  }

  console.log(`[Recover] Found ${untagged.length} untagged articles. Re-enriching...`);
  for (const article of untagged) {
    try {
      const enrichment = await llm.enrich({
        title: article.title,
        content: article.summary,
        contentUnavailable: article.contentUnavailable,
        language: languageName,
        maxTags: parseInt(process.env['MAX_TAGS'] || '3', 10),
      });
      await storage.updateArticle({ ...article, ...enrichment });
      console.log(`[Recover] Updated: ${article.title} with tags: ${enrichment.tags.join(', ')}`);
    } catch (e) {
      console.error(`[Recover] Failed to re-enrich article ${article.id}:`, e);
    }
  }
}

async function sendRecoveryNotification(
  storage: ReturnType<typeof createStorage>,
  llm: ReturnType<typeof createLlm>['llm'],
  notifier: TelegramAdapter,
  session: ReturnType<typeof createSession>,
  summaryLang: string,
  llmProvider: string,
  languageName: string,
) {
  console.log('[Recover] Reading articles from Inbox for re-notification...');
  const articles = await storage.getFromInbox();

  if (articles.length === 0) {
    console.log('[Recover] No articles found in Inbox. Nothing to notify.');
    return;
  }

  console.log(`[Recover] Re-sending summary for ${articles.length} articles.`);

  const runSynthesis = await llm.summarizeRun(articles, languageName);
  const { tagCounts, sourceCounts, sessionTags, articleCache, tagOrder } =
    await buildNotificationData({ articles });

  const recoveryDate = new Date();
  const runLabel = recoveryDate.getHours() < 12 ? 'morning' : 'evening';

  await notifier.sendRunSummary({
    runLabel,
    date: recoveryDate.toLocaleString() + ' (Recovery)',
    articlesProcessed: articles.length,
    articlesRemaining: 0,
    tagCounts,
    llmProvider: llmProvider as 'claude' | 'gemini',
    summaryLanguage: summaryLang,
  });

  await notifier.sendSourceStats(sourceCounts, summaryLang);
  if (runSynthesis) {
    await notifier.sendSynthesis(runSynthesis, summaryLang);
  }

  const messageId = await notifier.sendTagSelection(tagCounts, summaryLang);

  await session.save({
    chatId: process.env['TELEGRAM_CHAT_ID']!,
    messageId,
    runAt: recoveryDate.toISOString(),
    tags: sessionTags,
    tagOrder,
    articles: articleCache,
    ttl: Math.floor(Date.now() / 1000) + 43200,
  });

  console.log('[Recover] Recovery successful. Check Telegram.');
}

async function main() {
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';
  const languageName = LANGUAGE_MAP[summaryLang] || summaryLang;

  console.log(`[Recover] Initializing recovery (Lang: ${summaryLang})`);

  const storage = createStorage('Recover');
  const { llm, provider: llmProvider } = createLlm('Recover');
  const session = createSession();
  const notifier = new TelegramAdapter({
    token: process.env['TELEGRAM_BOT_TOKEN']!,
    chatId: process.env['TELEGRAM_CHAT_ID']!,
  });

  try {
    await reEnrichUntagged(storage, llm, languageName);
    await sendRecoveryNotification(storage, llm, notifier, session, summaryLang, llmProvider, languageName);
  } catch (error) {
    console.error('[Recover] Recovery failed:', error);
  }
}

main();
