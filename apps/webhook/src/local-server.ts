import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import * as dotenv from 'dotenv';
import { FileSessionAdapter, TelegramAdapter, createStorage, createTagPreference } from '@feed-digest/adapters';
import { handleCallback } from '@feed-digest/pipeline';

dotenv.config();

async function startPolling() {
  const token = process.env['TELEGRAM_BOT_TOKEN']!;
  const chatId = process.env['TELEGRAM_CHAT_ID']!;
  const secretToken = process.env['TELEGRAM_SECRET_TOKEN'] || '';

  console.log('\n--- Local Polling Server (Private Mode) ---');
  console.log(`[Polling] Listening for interactions from Chat ID: ${chatId}`);

  const bot = new TelegramBot(token, { polling: true });
  bot.on('polling_error', (error) => console.error('[Polling] Error:', error.message));
  bot.on('error', (error) => console.error('[Polling] General Error:', error.message));

  const session = new FileSessionAdapter();
  const storage = createStorage('Polling');
  const tagPreference = createTagPreference();
  const notifier = new TelegramAdapter({ token, chatId });
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

  bot.on('callback_query', async (callbackQuery) => {
    console.log(`[Polling] Received click: ${callbackQuery.data}`);

    if (callbackQuery.message?.chat.id.toString() !== chatId) {
      console.warn('[Polling] Ignored click from unauthorized user.');
      return;
    }

    try {
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch {
      // Ignore if already expired
    }

    try {
      await handleCallback({ callbackQuery, session, storage, notifier, tagPreference, summaryLang });
    } catch (error) {
      console.error('[Polling] Error handling callback:', error);
    }
  });

  console.log('Polling active. You can now click buttons on your phone!\n');

  // --- REST API for dashboard ---
  const app = express();
  const port = parseInt(process.env['API_PORT'] || '3333', 10);

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-telegram-bot-api-secret-token');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api/preferences', (req, res, next) => {
    const headerToken = req.headers['x-telegram-bot-api-secret-token'];
    if (secretToken && headerToken !== secretToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.get('/api/preferences/:chatId', async (req, res) => {
    const prefs = await tagPreference.get(req.params['chatId']);
    if (!prefs) {
      res.json({ chatId: req.params['chatId'], tags: {}, scores: {}, tagOverrides: {}, runCount: 0 });
      return;
    }

    const threshold = parseFloat(process.env['TAG_PREFERENCE_THRESHOLD'] || '0.6');
    const minRuns = parseInt(process.env['TAG_PREFERENCE_MIN_RUNS'] || '3', 10);
    const overrides = prefs.tagOverrides ?? {};

    const scores: Record<string, { score: number; autoSelected: boolean }> = {};
    for (const [tag, stats] of Object.entries(prefs.tags)) {
      const score = stats.presentedCount > 0 ? stats.selectionCount / stats.presentedCount : 0;
      const override = overrides[tag];
      scores[tag] = {
        score,
        autoSelected: override === 'auto' || (override !== 'filtered' && stats.presentedCount >= minRuns && score >= threshold),
      };
    }

    res.json({ ...prefs, tagOverrides: overrides, runCount: prefs.runCount ?? 0, scores, threshold, minRuns });
  });

  app.post('/api/preferences/:chatId/tags/:tag/override', express.json(), async (req, res) => {
    const { override } = req.body;
    if (override !== null && override !== 'auto' && override !== 'filtered') {
      res.status(400).json({ error: 'override must be "auto", "filtered", or null' });
      return;
    }
    await tagPreference.setTagOverride(req.params['chatId'], req.params['tag'], override);
    res.json({ tag: req.params['tag'], override });
  });

  app.delete('/api/preferences/:chatId', async (req, res) => {
    await tagPreference.reset(req.params['chatId']);
    res.json({ message: 'Preferences reset' });
  });

  app.listen(port, () => {
    console.log(`[API] Preferences API running on http://localhost:${port}/api/preferences/:chatId`);
  });
}

startPolling().catch(console.error);
