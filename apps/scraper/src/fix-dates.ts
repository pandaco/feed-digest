/**
 * One-shot script to fix publishedAt dates for all inbox articles.
 * Fetches each article URL, extracts the real publication date from meta tags,
 * and updates the storage.
 *
 * Usage: npx tsx --tsconfig tsconfig.base.json apps/scraper/src/fix-dates.ts
 */
import * as dotenv from 'dotenv';
import { JSDOM } from 'jsdom';
import { createStorage } from '@feed-digest/adapters';
import { Article } from '@feed-digest/core';

dotenv.config();

const DATE_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[property="og:article:published_time"]',
  'meta[name="date"]',
  'meta[name="pubdate"]',
  'meta[name="publish_date"]',
  'meta[name="DC.date.issued"]',
  'meta[itemprop="datePublished"]',
  'time[datetime]',
  '[itemprop="datePublished"]',
];

function extractPublishedDate(document: Document): string | null {
  for (const selector of DATE_SELECTORS) {
    const el = document.querySelector(selector);
    if (!el) continue;

    const raw = el.getAttribute('content') || el.getAttribute('datetime') || el.textContent?.trim();
    if (!raw) continue;

    const date = new Date(raw);
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent || '');
      const candidates = Array.isArray(json) ? json : [json];
      for (const item of candidates) {
        const raw = item.datePublished || item.dateCreated;
        if (raw) {
          const date = new Date(raw);
          if (!isNaN(date.getTime())) return date.toISOString();
        }
      }
    } catch { /* ignore */ }
  }

  return null;
}

async function fetchDate(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedDigest/1.0)' },
    });
    if (!response.ok) return null;

    const html = await response.text();
    const doc = new JSDOM(html, { url });
    return extractPublishedDate(doc.window.document);
  } catch {
    return null;
  }
}

async function main() {
  const storage = createStorage('FixDates');

  console.log('[FixDates] Loading inbox articles...');
  const articles = await storage.getFromInbox();
  console.log(`[FixDates] Found ${articles.length} articles.`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const tag = `[${i + 1}/${articles.length}]`;

    console.log(`${tag} Fetching date for: ${article.title}`);

    const publishedAt = await fetchDate(article.url);

    if (!publishedAt) {
      console.log(`${tag} No date found, skipping.`);
      skipped++;
      continue;
    }

    if (publishedAt === article.publishedAt) {
      console.log(`${tag} Date already correct.`);
      skipped++;
      continue;
    }

    console.log(`${tag} Updating: ${article.publishedAt} -> ${publishedAt}`);

    try {
      await storage.updateArticle({ ...article, publishedAt });
      fixed++;
    } catch (error) {
      console.error(`${tag} Failed to update:`, error);
      failed++;
    }

    // Small delay to avoid hammering servers
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n[FixDates] Done. Fixed: ${fixed}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('[FixDates] Fatal error:', err);
  process.exit(1);
});
