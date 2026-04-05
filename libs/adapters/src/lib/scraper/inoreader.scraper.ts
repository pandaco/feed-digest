import { chromium, Browser, Page, BrowserContext } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ScraperPort, CollectResult, ArticleMetadata, FetchContentResult } from '@feed-digest/core';

type InoreaderMode = 'unread' | 'starred';

interface RawArticleLink {
  title: string;
  url: string;
  feedSource: string;
  id: string;
  isSaved: boolean;
}

export class InoreaderAdapter implements ScraperPort {
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
      console.log('[InoreaderAdapter] Already logged in.');
      return;
    }

    console.log('[InoreaderAdapter] Authenticating...');
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
      page.click('button:has-text("Sign in")')
    ]);

    console.log('[InoreaderAdapter] Authentication successful.');

    const state = await this.context!.storageState();
    writeFileSync(this.sessionPath, JSON.stringify(state, null, 2));
    console.log('[InoreaderAdapter] Session saved.');
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
      console.warn('[InoreaderAdapter] Timed out waiting for articles.');
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
      console.log(`[InoreaderAdapter] Found ${found.length} potential links (scroll ${scrolls}).`);

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

      console.log(`[InoreaderAdapter] Total unique articles: ${articles.length}`);
      if (articles.length >= limit) break;
      scrolls++;
    }

    return articles;
  }

  private async getUnreadCount(page: Page): Promise<number> {
    return page.evaluate(() => {
      const titleMatch = document.title.match(/\((\d+)\)/);
      if (titleMatch) return parseInt(titleMatch[1], 10);

      const allLinks = Array.from(document.querySelectorAll('a, span, div'));
      for (const el of allLinks) {
        const text = el.textContent?.trim() || '';
        if (el.closest('[class*="tree"]') || el.closest('[class*="sidebar"]') || el.closest('[class*="nav"]')) {
          const countMatch = text.match(/^(\d+)$/);
          if (countMatch && parseInt(countMatch[1], 10) > 0) {
            return parseInt(countMatch[1], 10);
          }
        }
      }

      const articleContainers = document.querySelectorAll('[data-aid]');
      return articleContainers.length > 0 ? articleContainers.length : 0;
    });
  }

  async collect(limit: number): Promise<CollectResult> {
    const page = await this.getPage();

    try {
      await this.ensureAuthenticated(page);

      const target = this.mode === 'starred'
        ? 'https://www.inoreader.com/starred'
        : 'https://www.inoreader.com/all_articles';

      console.log(`[InoreaderAdapter] Navigating to ${target} (mode: ${this.mode})...`);
      await page.goto(target);
      await this.waitForArticlePane(page);

      const articles = await this.scrollAndCollect(page, limit);
      const totalCount = await this.getUnreadCount(page);
      console.log(`[InoreaderAdapter] Total found in UI: ${totalCount}`);

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
    const context = await this.getContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const html = await page.content();
      const doc = new JSDOM(html, { url });

      const publishedAt = this.extractPublishedDate(doc.window.document);

      const reader = new Readability(doc.window.document);
      const article = reader.parse();

      return {
        content: article?.textContent?.trim() || null,
        publishedAt,
      };
    } catch (error) {
      console.warn(`[InoreaderAdapter] Failed to fetch content for ${url}:`, error);
      return { content: null, publishedAt: null };
    } finally {
      await page.close();
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
    await this.markReadPage.waitForTimeout(3000);

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

  async markAsRead(articleId: string, url: string): Promise<void> {
    const action = this.mode === 'starred' ? 'unstar' : 'mark-as-read';
    const key = this.mode === 'starred' ? 's' : 'm';

    console.log(`[InoreaderAdapter] Attempting to ${action} article ${articleId}...`);
    const page = await this.initMarkReadPage();

    try {
      let container = await this.findArticleContainer(page, articleId, url);
      for (let i = 0; i < 30 && !container; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(800);
        container = await this.findArticleContainer(page, articleId, url);
      }

      if (container) {
        await container.scrollIntoViewIfNeeded();
        await container.click({ position: { x: 10, y: 15 } });
        await page.waitForTimeout(300);
        await page.keyboard.press(key);
        console.log(`[InoreaderAdapter] Successfully ${action}: ${url}`);
      } else {
        console.warn(`[InoreaderAdapter] Could not find article after scrolling: ${url}`);
      }
    } catch (error) {
      console.error(`[InoreaderAdapter] Failed to ${action} ${url}:`, error);
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
