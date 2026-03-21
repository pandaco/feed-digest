import { chromium, Browser, Page, BrowserContext } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ScraperPort, CollectResult, ArticleMetadata } from '@feed-digest/core';

export class InoreaderAdapter implements ScraperPort {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private mainPage: Page | null = null;
  private markReadPage: Page | null = null;
  private readonly sessionPath: string;

  constructor(sessionDir: string = process.cwd()) {
    this.sessionPath = join(sessionDir, 'session.json');
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
    
    // Check if we are already logged in
    const loginButton = await page.$('a[href*="/login"]');
    if (!loginButton) {
      console.log('[InoreaderAdapter] Already logged in.');
      return;
    }

    console.log('[InoreaderAdapter] Authenticating...');
    await page.goto('https://www.inoreader.com/login');
    
    // Handle cookie banner if present
    const cookieButton = await page.$('a:has-text("OK, I agree")');
    if (cookieButton) {
      await cookieButton.click();
      await page.waitForTimeout(500);
    }

    await page.fill('#username', process.env['INOREADER_EMAIL']!);
    await page.fill('#password', process.env['INOREADER_PASSWORD']!);
    
    console.log('[InoreaderAdapter] Submitting login form...');
    await Promise.all([
      page.waitForURL((url) => !url.href.includes('login'), { timeout: 60000 }),
      page.click('button:has-text("Sign in")')
    ]);

    console.log('[InoreaderAdapter] Authentication successful (URL changed).');
    
    // Save the storage state for future runs
    const state = await this.context!.storageState();
    writeFileSync(this.sessionPath, JSON.stringify(state, null, 2));
    console.log('[InoreaderAdapter] Session saved.');
  }

  async collect(limit: number): Promise<CollectResult> {
    const page = await this.getPage();

    try {
      await this.ensureAuthenticated(page);
      
      console.log('[InoreaderAdapter] Navigating to /all_articles...');
      await page.goto('https://www.inoreader.com/all_articles');
      
      // Wait for the main reader pane
      console.log('[InoreaderAdapter] Waiting for #reader_pane or .articles_container...');
      try {
        await page.waitForSelector('#reader_pane, .articles_container', { timeout: 30000 });
        
        console.log('[InoreaderAdapter] Waiting for articles to finish loading...');
        await page.waitForFunction(() => {
          const pane = document.querySelector('#reader_pane, .articles_container');
          const text = pane?.textContent || '';
          return !text.includes('Loading articles');
        }, { timeout: 40000 });
        
        await page.waitForTimeout(2000); 
      } catch (e) {
        console.warn('[InoreaderAdapter] Timed out waiting for articles.');
      }

      // Check the final state
      const paneText = await page.evaluate(() => document.querySelector('#reader_pane')?.textContent?.substring(0, 100).trim());
      console.log(`[InoreaderAdapter] Reader pane ready. Preview: "${paneText}"`);

      // Debug: sample links in the pane
      const sampleLinks = await page.evaluate(() => {
        const pane = document.querySelector('#reader_pane, .articles_container');
        if (!pane) return [];
        return Array.from(pane.querySelectorAll('a')).slice(0, 10).map(a => a.href);
      });
      console.log('[InoreaderAdapter] Sample links in pane:', sampleLinks);

      const articles: ArticleMetadata[] = [];
      let scrolls = 0;

      console.log(`[InoreaderAdapter] Collecting up to ${limit} articles...`);

      // Infinite scroll to load enough articles
      while (articles.length < limit && scrolls < 10) {
        // Progressive scroll
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(2000);

        const found = await page.evaluate(() => {
          const pane = document.querySelector('#reader_pane, .articles_container');
          if (!pane) return [];

          const links = Array.from(pane.querySelectorAll('a'));
          
          return links.map(link => {
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
              isSaved
            };
          }).filter(a => a !== null);
        });

        console.log(`[InoreaderAdapter] Found ${found.length} potential article links (scroll ${scrolls}).`);
        
        for (const a of found) {
          if (a && articles.length < limit && !articles.some(existing => existing.url === a.url)) {
            console.log(`[InoreaderAdapter] Adding article from ${a.feedSource}: ${a.title.substring(0, 50)}...`);
            articles.push({
              id: a.id,
              title: a.title,
              url: a.url,
              feedSource: a.feedSource,
              publishedAt: new Date().toISOString(),
              excerpt: '',
              isSaved: a.isSaved
            });
          }
        }
        
        console.log(`[InoreaderAdapter] Total unique articles collected: ${articles.length}`);
        if (articles.length >= limit) break;
        scrolls++;
      }

      // Get unread count from UI — try multiple strategies
      const totalUnread = await page.evaluate(() => {
        // 1. Document title often contains the count: "InoReader - (42)" or "All articles (42)"
        const titleMatch = document.title.match(/\((\d+)\)/);
        if (titleMatch) return parseInt(titleMatch[1], 10);

        // 2. Any element containing a numeric unread count near "All articles" in the sidebar
        const allLinks = Array.from(document.querySelectorAll('a, span, div'));
        for (const el of allLinks) {
          const text = el.textContent?.trim() || '';
          // Look for standalone numbers that look like unread counts (in badges, spans, etc.)
          if (el.closest('[class*="tree"]') || el.closest('[class*="sidebar"]') || el.closest('[class*="nav"]')) {
            const countMatch = text.match(/^(\d+)$/);
            if (countMatch && parseInt(countMatch[1], 10) > 0) {
              return parseInt(countMatch[1], 10);
            }
          }
        }

        // 3. Count all article containers currently in the DOM (lower bound)
        const articleContainers = document.querySelectorAll('[data-aid]');
        if (articleContainers.length > 0) return articleContainers.length;

        return 0;
      });

      console.log(`[InoreaderAdapter] Total unread found in UI: ${totalUnread}`);

      return {
        articles,
        totalUnread,
        remaining: Math.max(0, totalUnread - articles.length),
      };
    } finally {
      await page.close();
    }
  }

  async fetchContent(url: string): Promise<string | null> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const html = await page.content();
      const doc = new JSDOM(html, { url });
      const reader = new Readability(doc.window.document);
      const article = reader.parse();
      
      return article?.textContent?.trim() || null;
    } catch (error) {
      console.warn(`[InoreaderAdapter] Failed to fetch content for ${url}:`, error);
      return null;
    } finally {
      await page.close();
    }
  }

  async markAsRead(articleId: string, url: string): Promise<void> {
    console.log(`[InoreaderAdapter] Attempting to mark article ${articleId} as read...`);
    const context = await this.getContext();

    // Reuse a single persistent page for all mark-as-read operations (articles are processed in order)
    if (!this.markReadPage || this.markReadPage.isClosed()) {
      this.markReadPage = await context.newPage();

      // Block navigation away from Inoreader — clicking an article's external link
      // would otherwise navigate the page and break keyboard shortcuts
      await this.markReadPage.route('**/*', (route) => {
        const isDoc = route.request().resourceType() === 'document';
        const isExternal = !route.request().url().includes('inoreader.com');
        if (isDoc && isExternal) {
          route.abort();
        } else {
          route.continue();
        }
      });

      await this.markReadPage.goto('https://www.inoreader.com/all_articles', { waitUntil: 'domcontentloaded' });
      await this.markReadPage.waitForTimeout(3000);
    }

    const page = this.markReadPage;

    // Find the [data-aid] article container (not the external a[href] link)
    const findContainer = async () => {
      const byAid = await page.$(`[data-aid="${articleId}"]`);
      if (byAid) return byAid;

      // Fallback: find via the external link and walk up to the article container
      const byHref = await page.$(`a[href="${url}"]`);
      if (byHref) {
        return byHref.evaluateHandle((el) => el.closest('[data-aid]')) as Promise<import('playwright-core').ElementHandle | null>;
      }
      return null;
    };

    try {
      let container = await findContainer();
      for (let i = 0; i < 30 && !container; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(800);
        container = await findContainer();
      }

      if (container) {
        await container.scrollIntoViewIfNeeded();
        // Click at the far left of the row (checkbox area) to avoid clicking the external article link
        await container.click({ position: { x: 10, y: 15 } });
        await page.waitForTimeout(300);
        await page.keyboard.press('m');
        console.log(`[InoreaderAdapter] Successfully marked as read: ${url}`);
      } else {
        console.warn(`[InoreaderAdapter] Could not find article after scrolling: ${url}`);
      }
    } catch (error) {
      console.error(`[InoreaderAdapter] Failed to mark as read ${url}:`, error);
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
