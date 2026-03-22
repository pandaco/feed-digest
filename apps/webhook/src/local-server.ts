import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
import { FileSessionAdapter, TelegramAdapter, createStorage } from '@feed-digest/adapters';
import { handleCallback } from '@feed-digest/pipeline';

dotenv.config();

async function startPolling() {
  const token = process.env['TELEGRAM_BOT_TOKEN']!;
  const chatId = process.env['TELEGRAM_CHAT_ID']!;

  console.log('\n--- Local Polling Server (Private Mode) ---');
  console.log(`[Polling] Listening for interactions from Chat ID: ${chatId}`);

  const bot = new TelegramBot(token, { polling: true });
  bot.on('polling_error', (error) => console.error('[Polling] Error:', error.message));
  bot.on('error', (error) => console.error('[Polling] General Error:', error.message));

  const session = new FileSessionAdapter();
  const storage = createStorage('Polling');
  const notifier = new TelegramAdapter({ token, chatId });
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

  bot.on('callback_query', async (callbackQuery) => {
    console.log(`[Polling] Received click: ${callbackQuery.data}`);

    if (callbackQuery.message?.chat.id.toString() !== chatId) {
      console.warn('[Polling] Ignored click from unauthorized user.');
      return;
    }

    try {
      await handleCallback({ callbackQuery, session, storage, notifier, summaryLang });
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error('[Polling] Error handling callback:', error);
    }
  });

  console.log('Polling active. You can now click buttons on your phone!\n');
}

startPolling().catch(console.error);
