import * as dotenv from 'dotenv';
import { InoreaderAdapter, TelegramAdapter, createStorage, createLlm, createSession, createTagPreference } from '@feed-digest/adapters';
import { runPipeline } from '@feed-digest/pipeline';
import { ScraperPort } from '@feed-digest/core';

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

function isWithinScheduledWindow(): boolean {
  const now = new Date();
  const parisTime = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parisTime.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parisTime.find(p => p.type === 'minute')?.value || '0', 10);
  const totalMinutes = hour * 60 + minute;

  const validWindows = [7 * 60, 19 * 60];
  return validWindows.some(window => Math.abs(totalMinutes - window) <= 15);
}

async function main() {
  if (!isWithinScheduledWindow() && process.env['RUN_NOW'] !== 'true') {
    console.log('[Main] Outside of scheduled window. Skipping run.');
    return;
  }

  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';
  const scraper = createScraper();
  const storage = createStorage('Main');
  const { llm, provider: llmProvider } = createLlm('Main');
  const session = createSession();
  const tagPreference = createTagPreference();
  const notifier = new TelegramAdapter({
    token: process.env['TELEGRAM_BOT_TOKEN']!,
    chatId: process.env['TELEGRAM_CHAT_ID']!,
  });

  console.log(`[Main] Initializing pipeline (LLM: ${llmProvider}, Lang: ${summaryLang})`);

  try {
    await runPipeline({
      scraper,
      llm,
      storage,
      notifier,
      session,
      tagPreference,
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
