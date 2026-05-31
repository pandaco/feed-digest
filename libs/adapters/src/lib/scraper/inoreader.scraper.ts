import { chromium, Browser, Page, BrowserContext } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ScraperPort, CollectResult, ArticleMetadata, FetchContentResult, MarkAsReadResult } from '@feed-digest/core';

type InoreaderMode = 'unread' | 'starred';

interface RawArticleLink {
  title: string;
  url: string;
  feedSource: string;
  id: string;
  isSaved: boolean;
}

export class InoreaderScraper implements ScraperPort {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private mainPage: Page | null = null;
  private markReadPage: Page | null = null;
  private readonly sessionPath: string;
  private readonly mode: InoreaderMode;

  constructor(sessionDir: string = process.cwd(), mode: InoreaderMode = 'unread') {
    this.sessionPath = join(sessionDir, 'session.json');
    this.mode = mode;
  }

  private async getPage(): Promise<Page> {
    if (this.mainPage && !this.mainPage.isClosed()) return this.mainPage;
    const context = await this.getContext();
    this.mainPage = await context.newPage();
    return this.mainPage;
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.browser = await chromium.launch({
      headless: process.env['SHOW_BROWSER'] !== 'true',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const storageState = existsSync(this.sessionPath) ? JSON.parse(readFileSync(this.sessionPath, 'utf-8')) : undefined;
    this.context = await this.browser.newContext({ storageState });

    return this.context;
  }

  private async ensureAuthenticated(page: Page): Promise<void> {
    await page.goto('https://www.inoreader.com/');

    const loginButton = await page.$('a[href*="/login"]');
    if (!loginButton) {
      console.log('[InoreaderScraper] Already logged in.');
      return;
    }

    console.log('[InoreaderScraper] Authenticating...');
    await page.goto('https://www.inoreader.com/login');

    const cookieButton = await page.$('a:has-text("OK, I agree")');
    if (cookieButton) {
      await cookieButton.click();
      await page.waitForTimeout(500);
    }

    await page.fill('#username', process.env['INOREADER_EMAIL']!);
    await page.fill('#password', process.env['INOREADER_PASSWORD']!);

    await Promise.all([
      page.waitForURL((url) => !url.href.includes('login'), { timeout: 60000 }),
      page.click('button[type="submit"]:has-text("Sign in")')
    ]);

    console.log('[InoreaderScraper] Authentication successful.');

    const state = await this.context!.storageState();
    writeFileSync(this.sessionPath, JSON.stringify(state, null, 2));
    console.log('[InoreaderScraper] Session saved.');
  }

  private async waitForArticlePane(page: Page): Promise<void> {
    try {
      await page.waitForSelector('#reader_pane, .articles_container', { timeout: 30000 });
      await page.waitForFunction(() => {
        const pane = document.querySelector('#reader_pane, .articles_container');
        return !(pane?.textContent || '').includes('Loading articles');
      }, { timeout: 40000 });
      await page.waitForTimeout(2000);
    } catch {
      console.warn('[InoreaderScraper] Timed out waiting for articles.');
    }
  }

  private async extractArticleLinks(page: Page): Promise<RawArticleLink[]> {
    return page.evaluate(() => {
      const pane = document.querySelector('#reader_pane, .articles_container');
      if (!pane) return [];

      return Array.from(pane.querySelectorAll('a')).map(link => {
        const href = link.href;
        const text = link.textContent?.trim() || '';

        if (!href || href.includes('javascript:') || text.length < 15) return null;

        const isInternalUI = href.includes('inoreader.com/feed/') ||
                            href.includes('inoreader.com/folder/') ||
                            href.includes('inoreader.com/all_articles') ||
                            href.includes('inoreader.com/login');
        if (isInternalUI) return null;

        const articleContainer = link.closest('[data-aid]');
        const isSaved = articleContainer
          ? !!(articleContainer.querySelector('.article_starred, .icon-star.active, .star_active, [class*="starred"], [class*="saved"]')
            || articleContainer.classList.contains('starred')
            || articleContainer.classList.contains('saved'))
          : false;

        return {
          title: text,
          url: href,
          feedSource: link.closest('.article_header, .article_tile, .article_row')?.querySelector('.article_feed_title, .feed_title')?.textContent?.trim() || 'Unknown Source',
          id: articleContainer?.getAttribute('data-aid') || href,
          isSaved,
        };
      }).filter(a => a !== null);
    });
  }

  private async scrollAndCollect(page: Page, limit: number): Promise<ArticleMetadata[]> {
    const articles: ArticleMetadata[] = [];
    let scrolls = 0;

    while (articles.length < limit && scrolls < 10) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(2000);

      const found = await this.extractArticleLinks(page);
      console.log(`[InoreaderScraper] Found ${found.length} potential links (scroll ${scrolls}).`);

      for (const a of found) {
        if (articles.length >= limit) break;
        if (articles.some(existing => existing.url === a.url)) continue;

        articles.push({
          id: a.id,
          title: a.title,
          url: a.url,
          feedSource: a.feedSource,
          publishedAt: new Date().toISOString(),
          excerpt: '',
          isSaved: a.isSaved,
          scraperSource: this.mode === 'starred' ? 'inoreader-saved' : 'inoreader',
        });
      }

      console.log(`[InoreaderScraper] Total unique articles: ${articles.length}`);
      if (articles.length >= limit) break;
      scrolls++;
    }

    return articles;
  }

  private async getUnreadCount(page: Page): Promise<number> {
    return page.evaluate(() => {
      // Sélecteur spécifique pour le compteur d'Inoreader dans la sidebar
      const counter = document.querySelector('.unread_count, [class*="unread_count"]');
      if (counter?.textContent) {
        const count = parseInt(counter.textContent.replace(/\D/g, ''), 10);
        if (!isNaN(count)) return count;
      }

      // Fallback vers le compte d'éléments chargés dans le DOM
      const articleContainers = document.querySelectorAll('[data-aid]');
      return articleContainers.length;
    });
  }

  async collect(limit: number): Promise<CollectResult> {
    const page = await this.getPage();

    try {
      await this.ensureAuthenticated(page);

      const target = this.mode === 'starred'
        ? 'https://www.inoreader.com/starred'
        : 'https://www.inoreader.com/all_articles';

      console.log(`[InoreaderScraper] Navigating to ${target} (mode: ${this.mode})...`);
      await page.goto(target);
      await this.waitForArticlePane(page);

      const articles = await this.scrollAndCollect(page, limit);
      const totalCount = await this.getUnreadCount(page);
      console.log(`[InoreaderScraper] Total found in UI: ${totalCount}`);

      return {
        articles,
        totalUnread: totalCount,
        remaining: Math.max(0, totalCount - articles.length),
      };
    } finally {
      await page.close();
    }
  }

  async fetchContent(url: string): Promise<FetchContentResult> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (!res.ok) {
        console.warn(`[InoreaderScraper] HTTP ${res.status} for ${url}`);
        return { content: null, publishedAt: null };
      }

      const html = await res.text();
      const doc = new JSDOM(html, { url });

      const publishedAt = this.extractPublishedDate(doc.window.document);

      const reader = new Readability(doc.window.document);
      const article = reader.parse();

      return {
        content: article?.textContent?.trim() || null,
        publishedAt,
      };
    } catch (error) {
      console.warn(`[InoreaderScraper] Failed to fetch content for ${url}:`, error);
      return { content: null, publishedAt: null };
    }
  }

  private extractPublishedDate(document: Document): string | null {
    const selectors = [
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

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;

      const raw = el.getAttribute('content') || el.getAttribute('datetime') || el.textContent?.trim();
      if (!raw) continue;

      const date = new Date(raw);
      if (!isNaN(date.getTime())) return date.toISOString();
    }

    // Try JSON-LD
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
      } catch { /* ignore malformed JSON-LD */ }
    }

    return null;
  }

  private async initMarkReadPage(): Promise<Page> {
    if (this.markReadPage && !this.markReadPage.isClosed()) return this.markReadPage;

    const context = await this.getContext();
    this.markReadPage = await context.newPage();

    await this.markReadPage.route('**/*', (route) => {
      const isDoc = route.request().resourceType() === 'document';
      const isExternal = !route.request().url().includes('inoreader.com');
      if (isDoc && isExternal) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const targetUrl = this.mode === 'starred'
      ? 'https://www.inoreader.com/starred'
      : 'https://www.inoreader.com/all_articles';
    await this.markReadPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await this.markReadPage.waitForTimeout(1500);

    return this.markReadPage;
  }

  private async findArticleContainer(page: Page, articleId: string, url: string) {
    const byAid = await page.$(`[data-aid="${articleId}"]`);
    if (byAid) return byAid;

    const byHref = await page.$(`a[href="${url}"]`);
    if (byHref) {
      return byHref.evaluateHandle((el) => el.closest('[data-aid]')) as Promise<import('playwright-core').ElementHandle | null>;
    }
    return null;
  }

  /**
   * Pre-scroll the markRead page to lazy-load `expectedCount` items into
   * the DOM up front. Each subsequent `markAsRead` then finds its target
   * by direct selector without scrolling, dropping per-article cost from
   * ~5s (15 forced scrolls) to <500ms.
   */
  async prepareForMarkAsRead(expectedCount: number): Promise<void> {
    const page = await this.initMarkReadPage();
    // Target ~2× expectedCount so removals from the list (each mark
    // shrinks the DOM) still leave enough loaded ahead.
    const target = Math.max(expectedCount * 2, 20);
    // Hard scroll cap. Each scroll loads ~5 articles, so 60 scrolls
    // covers ~300 items — well beyond any realistic batch.
    const maxScrolls = Math.min(60, Math.ceil(target / 4));
    let loaded = await page.$$eval('[data-aid]', els => els.length);
    let scrolls = 0;
    while (loaded < target && scrolls < maxScrolls) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(350);
      const next = await page.$$eval('[data-aid]', els => els.length);
      if (next === loaded) break; // hit the bottom of the list
      loaded = next;
      scrolls++;
    }
    // Back to the top so per-article search starts where items live.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    console.log(`[InoreaderScraper] Pre-loaded ${loaded} items into markRead DOM (${scrolls} scroll${scrolls === 1 ? '' : 's'}).`);
  }

  async markAsRead(articleId: string, url: string): Promise<MarkAsReadResult> {
    const action = this.mode === 'starred' ? 'unstar' : 'mark-as-read';
    const key = this.mode === 'starred' ? 's' : 'm';

    const page = await this.initMarkReadPage();

    try {
      let container = await this.findArticleContainer(page, articleId, url);
      let scrolls = 0;
      // With `prepareForMarkAsRead` called once at run start, the target
      // is usually already in the DOM (0 scrolls). 5 is enough to absorb
      // the cases where the list shrinks faster than expected.
      for (; scrolls < 5 && !container; scrolls++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(350);
        container = await this.findArticleContainer(page, articleId, url);
      }

      if (!container) {
        console.warn(`[InoreaderScraper] ${action} not found after ${scrolls} scroll(s): ${url}`);
        return { ok: false, scrolls };
      }

      await container.scrollIntoViewIfNeeded();
      await container.click({ position: { x: 10, y: 15 } });
      await page.waitForTimeout(120);
      await page.keyboard.press(key);
      return { ok: true, scrolls };
    } catch (error) {
      console.error(`[InoreaderScraper] ${action} crashed for ${url}:`, error);
      return { ok: false, scrolls: -1 };
    }
  }

  async close(): Promise<void> {
    if (this.mainPage) await this.mainPage.close();
    if (this.markReadPage && !this.markReadPage.isClosed()) await this.markReadPage.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.mainPage = null;
    this.markReadPage = null;
    this.context = null;
    this.browser = null;
  }
}
