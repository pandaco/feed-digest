import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createStorage, createTagPreference, createLlm } from '@feed-digest/adapters';
import { normalizeTag, extractToc, TocEntry } from '@feed-digest/core';

dotenv.config();

async function startServer() {
  const secretToken = process.env['TELEGRAM_SECRET_TOKEN'] || '';

  const storage = createStorage('API');
  const tagPreference = createTagPreference();
  const { llm } = createLlm('API');
  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

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

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      dateFormat: process.env['DATE_FORMAT'] || 'yyyy-MM-dd HH:mm',
    });
  });

  app.use('/api', (req, res, next) => {
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
    const tag = normalizeTag(req.params['tag']);
    await tagPreference.setTagOverride(req.params['chatId'], tag, override);
    res.json({ tag, override });
  });

  app.delete('/api/preferences/:chatId', async (req, res) => {
    await tagPreference.reset(req.params['chatId']);
    res.json({ message: 'Preferences reset' });
  });

  // --- User Interests API ---
  const interestsFilePath = path.join(process.cwd(), '.user-interests.txt');

  app.get('/api/interests', (_req, res) => {
    try {
      const text = fs.existsSync(interestsFilePath) ? fs.readFileSync(interestsFilePath, 'utf-8') : '';
      res.json({ text });
    } catch (error) {
      console.error('[API] Failed to read interests:', error);
      res.status(500).json({ error: 'Failed to read interests' });
    }
  });

  app.post('/api/interests', express.json(), (req, res) => {
    try {
      const { text } = req.body;
      if (typeof text !== 'string') {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      fs.writeFileSync(interestsFilePath, text, 'utf-8');
      res.json({ message: 'Interests saved' });
    } catch (error) {
      console.error('[API] Failed to save interests:', error);
      res.status(500).json({ error: 'Failed to save interests' });
    }
  });

  // --- Inbox API ---
  app.get('/api/inbox', async (_req, res) => {
    try {
      const articles = await storage.getFromInbox();
      const now = new Date().toISOString();
      res.json(articles.filter(a => !a.snoozedUntil || a.snoozedUntil <= now));
    } catch (error) {
      console.error('[API] Failed to fetch inbox:', error);
      res.status(500).json({ error: 'Failed to fetch inbox' });
    }
  });

  app.get('/api/inbox/snoozed', async (_req, res) => {
    try {
      const articles = await storage.getFromInbox();
      const now = new Date().toISOString();
      res.json(articles.filter(a => a.snoozedUntil && a.snoozedUntil > now));
    } catch (error) {
      console.error('[API] Failed to fetch snoozed articles:', error);
      res.status(500).json({ error: 'Failed to fetch snoozed articles' });
    }
  });

  app.post('/api/inbox/:articleId/snooze', express.json(), async (req, res) => {
    const { snoozedUntil } = req.body;
    if (!snoozedUntil || typeof snoozedUntil !== 'string') {
      res.status(400).json({ error: 'snoozedUntil is required (ISO 8601 date)' });
      return;
    }
    try {
      const articles = await storage.getFromInbox();
      const article = articles.find(a => a.id === req.params['articleId']);
      if (!article) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }
      await storage.updateArticle({ ...article, snoozedUntil });
      res.json({ message: 'Article snoozed' });
    } catch (error) {
      console.error('[API] Failed to snooze article:', error);
      res.status(500).json({ error: 'Failed to snooze article' });
    }
  });

  app.post('/api/inbox/:articleId/unsnooze', express.json(), async (req, res) => {
    try {
      const articles = await storage.getFromInbox();
      const article = articles.find(a => a.id === req.params['articleId']);
      if (!article) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }
      await storage.updateArticle({ ...article, snoozedUntil: undefined });
      res.json({ message: 'Article unsnoozed' });
    } catch (error) {
      console.error('[API] Failed to unsnooze article:', error);
      res.status(500).json({ error: 'Failed to unsnooze article' });
    }
  });

  app.delete('/api/inbox/:articleId', async (req, res) => {
    try {
      await storage.deleteFromInbox([req.params['articleId']]);
      res.json({ message: 'Article deleted' });
    } catch (error) {
      console.error('[API] Failed to delete article:', error);
      res.status(500).json({ error: 'Failed to delete article' });
    }
  });

  app.post('/api/inbox/summary', express.json(), async (req, res) => {
    try {
      let articles = await storage.getFromInbox();

      const period = req.body?.period as string | undefined;
      if (period) {
        const now = new Date();
        let since: Date;
        if (period === 'today') {
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
          since = new Date(now);
          since.setDate(since.getDate() - 7);
        } else if (period === 'month') {
          since = new Date(now);
          since.setMonth(since.getMonth() - 1);
        } else {
          since = new Date(0);
        }
        articles = articles.filter(a => new Date(a.publishedAt) >= since);
      }

      const html = await llm.summarizeInbox(articles, summaryLang);
      res.json({ html });
    } catch (error) {
      console.error('[API] Failed to generate inbox summary:', error);
      res.status(500).json({ error: 'Failed to generate summary' });
    }
  });

  app.post('/api/inbox/synthesize', express.json(), async (req, res) => {
    const { articleIds } = req.body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      res.status(400).json({ error: 'articleIds must be a non-empty array' });
      return;
    }
    try {
      const allArticles = await storage.getFromInbox();
      const toSynthesize = allArticles.filter(a => articleIds.includes(a.id));
      if (toSynthesize.length === 0) {
        res.status(404).json({ error: 'No matching articles found' });
        return;
      }
      const html = await llm.summarizeInbox(toSynthesize, summaryLang);
      res.json({ html });
    } catch (error) {
      console.error('[API] Failed to synthesize articles:', error);
      res.status(500).json({ error: 'Failed to synthesize articles' });
    }
  });

  app.post('/api/inbox/bulk-delete', express.json(), async (req, res) => {
    const { articleIds } = req.body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      res.status(400).json({ error: 'articleIds must be a non-empty array' });
      return;
    }
    try {
      await storage.deleteFromInbox(articleIds);
      res.json({ deleted: articleIds.length });
    } catch (error) {
      console.error('[API] Failed to bulk delete:', error);
      res.status(500).json({ error: 'Failed to bulk delete' });
    }
  });

  app.post('/api/inbox/save', express.json(), async (req, res) => {
    const { articleIds } = req.body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      res.status(400).json({ error: 'articleIds must be a non-empty array' });
      return;
    }
    try {
      const allArticles = await storage.getFromInbox();
      const toSave = allArticles.filter(a => articleIds.includes(a.id));
      if (toSave.length === 0) {
        res.status(404).json({ error: 'No matching articles found in inbox' });
        return;
      }
      await storage.appendToSaved(toSave.map(a => ({ ...a, isSaved: true })));
      await storage.deleteFromInbox(toSave.map(a => a.id));
      res.json({ saved: toSave.length });
    } catch (error) {
      console.error('[API] Failed to save articles:', error);
      res.status(500).json({ error: 'Failed to save articles' });
    }
  });

  // --- Saved API ---
  app.get('/api/saved', async (_req, res) => {
    try {
      const articles = await storage.getFromSaved();
      res.json(articles);
    } catch (error) {
      console.error('[API] Failed to fetch saved:', error);
      res.status(500).json({ error: 'Failed to fetch saved articles' });
    }
  });

  app.delete('/api/saved/:articleId', async (req, res) => {
    try {
      await storage.deleteFromSaved([req.params['articleId']]);
      res.json({ message: 'Article removed from saved' });
    } catch (error) {
      console.error('[API] Failed to delete saved article:', error);
      res.status(500).json({ error: 'Failed to delete saved article' });
    }
  });

  app.post('/api/saved/bulk-delete', express.json(), async (req, res) => {
    const { articleIds } = req.body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      res.status(400).json({ error: 'articleIds must be a non-empty array' });
      return;
    }
    try {
      await storage.deleteFromSaved(articleIds);
      res.json({ deleted: articleIds.length });
    } catch (error) {
      console.error('[API] Failed to bulk delete saved:', error);
      res.status(500).json({ error: 'Failed to bulk delete saved articles' });
    }
  });

  // --- Article TOC & Content API ---
  const tocCache = new Map<string, TocEntry[]>();
  const contentCache = new Map<string, { content: string; wordCount: number }>();

  app.get('/api/articles/:articleId/toc', async (req, res) => {
    const articleId = req.params['articleId'];

    if (tocCache.has(articleId)) {
      res.json({ toc: tocCache.get(articleId) });
      return;
    }

    try {
      const [inbox, saved] = await Promise.all([storage.getFromInbox(), storage.getFromSaved()]);
      const article = [...inbox, ...saved].find(a => a.id === articleId);
      if (!article) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }

      const response = await fetch(article.url);
      if (!response.ok) {
        res.json({ toc: [] });
        return;
      }

      const html = await response.text();
      const toc = extractToc(html);
      tocCache.set(articleId, toc);
      res.json({ toc });
    } catch (error) {
      console.error('[API] Failed to extract TOC:', error);
      res.status(500).json({ error: 'Failed to extract table of contents' });
    }
  });

  app.get('/api/articles/:articleId/content', async (req, res) => {
    const articleId = req.params['articleId'];

    if (contentCache.has(articleId)) {
      res.json(contentCache.get(articleId));
      return;
    }

    try {
      // Find article URL across inbox and saved
      const [inbox, saved] = await Promise.all([storage.getFromInbox(), storage.getFromSaved()]);
      const article = [...inbox, ...saved].find(a => a.id === articleId);
      if (!article) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }

      const response = await fetch(article.url);
      if (!response.ok) {
        res.json({ content: article.summary, wordCount: article.summary.split(/\s+/).length });
        return;
      }

      const html = await response.text();
      const wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
      const result = { content: html, wordCount };
      contentCache.set(articleId, result);
      res.json(result);
    } catch (error) {
      console.error('[API] Failed to fetch article content:', error);
      res.status(500).json({ error: 'Failed to fetch article content' });
    }
  });

  app.listen(port, () => {
    console.log(`[API] Dashboard API running on http://localhost:${port}`);
  });
}

startServer().catch(console.error);
