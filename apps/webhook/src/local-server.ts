import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
import { 
  FileSessionAdapter,
  GoogleSheetsAdapter, 
  NotionAdapter,
  TelegramAdapter 
} from '@feed-digest/adapters';
import { StoragePort } from '@feed-digest/core';
import { handleCallback } from '@feed-digest/pipeline';

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
      throw new Error(`[LocalServer] Unknown STORAGE_BACKEND: "${backend}". Supported: google-sheets, notion`);
  }
}

/**
 * Local development server using "Polling" mode.
 * This is 100% private and does not require Ngrok or any public URL.
 * Your computer will actively ask Telegram for new clicks.
 */
async function startPolling() {
  const token = process.env['TELEGRAM_BOT_TOKEN']!;
  const chatId = process.env['TELEGRAM_CHAT_ID']!;

  console.log('\n--- 🛡️  Local Polling Server (Private Mode) ---');
  console.log(`[Polling] Listening for interactions from Chat ID: ${chatId}`);

  // 1. Initialize Bot in Polling mode
  const bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (error) => {
    console.error('[Polling] Error:', error.message);
  });

  bot.on('error', (error) => {
    console.error('[Polling] General Error:', error.message);
  });

  console.log('[Polling] Bot instance created and polling started...');

  // 2. Initialize Adapters
  const session = new FileSessionAdapter();
  
  const storage = createStorage();

  const notifier = new TelegramAdapter({
    token,
    chatId,
  });

  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

  // 3. Listen for Callback Queries (Button Clicks)
  bot.on('callback_query', async (callbackQuery) => {
    console.log(`[Polling] Received click: ${callbackQuery.data}`);

    // Security: Only process clicks from your authorized Chat ID
    if (callbackQuery.message?.chat.id.toString() !== chatId) {
      console.warn('[Polling] Ignored click from unauthorized user.');
      return;
    }

    try {
      await handleCallback({
        callbackQuery,
        session,
        storage,
        notifier,
        summaryLang
      });
      
      // Answer the callback to remove the "spinner" in Telegram UI
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error('[Polling] Error handling callback:', error);
    }
  });

  console.log('🚀 Polling active. You can now click buttons on your phone!\n');
}

startPolling().catch(console.error);
