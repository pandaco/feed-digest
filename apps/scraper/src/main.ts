import * as dotenv from 'dotenv';
import {
  InoreaderAdapter,
  GoogleSheetsAdapter,
  NotionAdapter,
  TelegramAdapter,
  DynamoDbAdapter,
  FileSessionAdapter,
  ClaudeAdapter,
  GeminiAdapter
} from '@feed-digest/adapters';
import { runPipeline } from '@feed-digest/pipeline';
import { LlmPort, ScraperPort, StoragePort } from '@feed-digest/core';

dotenv.config();

function createScraper(): ScraperPort {
  const source = process.env['SCRAPER_SOURCE'] || 'inoreader';
  switch (source) {
    case 'inoreader':
      return new InoreaderAdapter();
    default:
      throw new Error(`[Main] Unknown SCRAPER_SOURCE: "${source}". Supported: inoreader`);
  }
}

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
      throw new Error(`[Main] Unknown STORAGE_BACKEND: "${backend}". Supported: google-sheets, notion`);
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
      throw new Error(`[Main] Unknown LLM_PROVIDER: "${provider}". Supported: claude, gemini`);
  }
}

/**
 * Main entry point for the scraper application.
 * Composition root that initializes all adapters and triggers the pipeline.
 */
async function main() {
  // 1. Paris Timezone Guard (07:00 or 19:00 +/- 15 min)
  const now = new Date();
  const parisTime = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(now);

  const hour = parseInt(parisTime.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parisTime.find(p => p.type === 'minute')?.value || '0', 10);
  const totalMinutes = hour * 60 + minute;

  const validWindows = [7 * 60, 19 * 60]; // 07:00 and 19:00
  const isWithinWindow = validWindows.some(window => Math.abs(totalMinutes - window) <= 15);

  if (!isWithinWindow && process.env['RUN_NOW'] !== 'true') {
    console.log(`[Main] Outside of scheduled window (${hour}:${minute} Paris). Skipping run.`);
    return;
  }

  // 2. Load Configuration
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

  // 3. Adapter Initialization
  const scraper = createScraper();
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

  console.log(`[Main] Initializing pipeline (Scraper: ${process.env['SCRAPER_SOURCE'] || 'inoreader'}, Storage: ${process.env['STORAGE_BACKEND'] || 'google-sheets'}, LLM: ${llmProvider}, Lang: ${summaryLang})`);

  // 4. Run Pipeline
  try {
    await runPipeline({
      scraper,
      llm,
      storage,
      notifier,
      session,
      summaryLang,
      llmProvider,
      telegramChatId: process.env['TELEGRAM_CHAT_ID']!,
      limit: parseInt(process.env['ARTICLES_LIMIT'] || '150', 10),
      maxTags: parseInt(process.env['MAX_TAGS'] || '3', 10),
      concurrency: parseInt(process.env['PIPELINE_CONCURRENCY'] || '5', 10),
      minDelayMs: parseInt(process.env['PIPELINE_MIN_DELAY_MS'] || '1000', 10),
      maxDelayMs: parseInt(process.env['PIPELINE_MAX_DELAY_MS'] || '3000', 10),
    });
    process.exit(0);
  } catch (error) {
    console.error('[Main] Pipeline failed:', error);
    process.exit(1);
  }
}

main();
