import * as dotenv from 'dotenv';
import { 
  GoogleSheetsAdapter, 
  NotionAdapter,
  TelegramAdapter, 
  DynamoDbAdapter, 
  FileSessionAdapter,
  ClaudeAdapter, 
  GeminiAdapter 
} from '@feed-digest/adapters';
import { LlmPort, Article, TelegramSession, StoragePort } from '@feed-digest/core';

dotenv.config();

function createStorage(): StoragePort {
  const backend = process.env['STORAGE_BACKEND'] || 'google-sheets';
  switch (backend) {
    case 'google-sheets':
      return new GoogleSheetsAdapter({
        spreadsheetId: process.env['GOOGLE_SHEET_ID']!,
        serviceAccountJson: process.env['GOOGLE_SERVICE_ACCOUNT_JSON']!,
      });
    case 'notion':
      return new NotionAdapter({
        apiKey: process.env['NOTION_API_KEY']!,
        inboxDatabaseId: process.env['NOTION_INBOX_DB_ID']!,
        allDatabaseId: process.env['NOTION_ALL_DB_ID']!,
        savedDatabaseId: process.env['NOTION_SAVED_DB_ID']!,
      });
    default:
      throw new Error(`[Recover] Unknown STORAGE_BACKEND: "${backend}"`);
  }
}

function createLlm(): { llm: LlmPort; provider: 'claude' | 'gemini' } {
  const provider = (process.env['LLM_PROVIDER'] || 'claude') as 'claude' | 'gemini';
  switch (provider) {
    case 'gemini':
      return { llm: new GeminiAdapter(process.env['GEMINI_API_KEY']!, process.env['GEMINI_MODEL']), provider };
    case 'claude':
      return { llm: new ClaudeAdapter(process.env['ANTHROPIC_API_KEY']!, process.env['CLAUDE_MODEL']), provider };
    default:
      throw new Error(`[Recover] Unknown LLM_PROVIDER: "${provider}"`);
  }
}

/**
 * Recovery script:
 * 1. Detect untagged articles in Inbox.
 * 2. Re-enrich them via LLM and update storage.
 * 3. Re-send the Telegram summary for the most recent run.
 */
async function main() {
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';
  const languageMap: Record<string, string> = { fr: 'French', en: 'English' };
  const languageName = languageMap[summaryLang] || summaryLang;

  console.log(`[Recover] Initializing recovery (Lang: ${summaryLang})`);

  // 1. Initialize Adapters
  const storage = createStorage();
  const { llm, provider: llmProvider } = createLlm();

  const session = process.env['NODE_ENV'] === 'development'
    ? new FileSessionAdapter()
    : new DynamoDbAdapter({
        region: process.env['AWS_REGION'] || 'eu-west-1',
        tableName: process.env['DYNAMODB_TABLE_NAME']!,
      });

  const notifier = new TelegramAdapter({
    token: process.env['TELEGRAM_BOT_TOKEN']!,
    chatId: process.env['TELEGRAM_CHAT_ID']!,
  });

  try {
    // 2. Detect untagged articles
    console.log('[Recover] Checking for untagged articles in Inbox...');
    const untagged = await storage.getUntaggedArticles();

    if (untagged.length > 0) {
      console.log(`[Recover] Found ${untagged.length} untagged articles. Re-enriching...`);
      for (const article of untagged) {
        console.log(`[Recover] Enriching: ${article.title}`);
        try {
          const enrichment = await llm.enrich({
            title: article.title,
            content: article.summary, // In recovery, we use the title or previous summary as content if not available
            contentUnavailable: article.contentUnavailable,
            language: languageName,
            maxTags: parseInt(process.env['MAX_TAGS'] || '3', 10),
          });

          const updatedArticle: Article = { ...article, ...enrichment };
          await storage.updateArticle(updatedArticle);
          console.log(`[Recover] Updated: ${article.title} with tags: ${enrichment.tags.join(', ')}`);
        } catch (e) {
          console.error(`[Recover] Failed to re-enrich article ${article.id}:`, e);
        }
      }
    } else {
      console.log('[Recover] No untagged articles found.');
    }

    // 3. Read articles from Inbox for re-notification
    console.log('[Recover] Reading articles from Inbox for re-notification...');
    const articles = await storage.getFromInbox();
    
    if (articles.length === 0) {
      console.log('[Recover] No articles found in Inbox. Nothing to notify.');
      return;
    }

    console.log(`[Recover] Re-sending summary for all ${articles.length} articles currently in Inbox.`);

    // 4. Re-generate Synthesis
    console.log('[Recover] Re-generating global run synthesis...');
    const runSynthesis = await llm.summarizeRun(articles, languageName);

    // 5. Prepare Metadata for notification
    const tagCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const sessionTags: TelegramSession['tags'] = {};
    const articleCache: TelegramSession['articles'] = {};

    for (const article of articles) {
      articleCache[article.id] = { title: article.title, url: article.url };
      sourceCounts[article.feedSource] = (sourceCounts[article.feedSource] || 0) + 1;
      for (const tag of article.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        if (!sessionTags[tag]) {
          sessionTags[tag] = { selected: false, articleIds: [] };
        }
        sessionTags[tag].articleIds.push(article.id);
      }
    }

    // 6. Send Notification
    console.log('[Recover] Sending Telegram summary...');
    const recoveryDate = new Date();
    const runLabel = recoveryDate.getHours() < 12 ? 'morning' : 'evening';
    const tagOrder = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    await notifier.sendRunSummary({
      runLabel,
      date: recoveryDate.toLocaleString() + ' (Recovery)',
      articlesProcessed: articles.length,
      articlesRemaining: 0,
      tagCounts,
      llmProvider: llmProvider,
      summaryLanguage: summaryLang,
    });

    await notifier.sendSourceStats(sourceCounts, summaryLang);

    if (runSynthesis) {
      await notifier.sendSynthesis(runSynthesis, summaryLang);
    }

    const messageId = await notifier.sendTagSelection(tagCounts, summaryLang);

    // 7. Save Session
    await session.save({
      chatId: process.env['TELEGRAM_CHAT_ID']!,
      messageId,
      runAt: recoveryDate.toISOString(),
      tags: sessionTags,
      tagOrder,
      articles: articleCache,
      ttl: Math.floor(Date.now() / 1000) + 43200
    });

    console.log('[Recover] Recovery successful. Check Telegram.');
  } catch (error) {
    console.error('[Recover] Recovery failed:', error);
  }
}

main();
