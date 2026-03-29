import { ScraperPort, CollectResult, ArticleMetadata, FetchContentResult } from '@feed-digest/core';

/**
 * Wraps multiple scrapers and merges their results.
 * Collects from each source sequentially, deduplicates by URL.
 */
export class CompositeScraperAdapter implements ScraperPort {
  constructor(private scrapers: ScraperPort[]) {}

  async collect(limit: number): Promise<CollectResult> {
    const allArticles: ArticleMetadata[] = [];
    const seenUrls = new Set<string>();
    let totalUnread = 0;
    let remaining = 0;

    for (const scraper of this.scrapers) {
      const budget = limit - allArticles.length;
      if (budget <= 0) break;

      const result = await scraper.collect(budget);
      for (const article of result.articles) {
        if (!seenUrls.has(article.url)) {
          seenUrls.add(article.url);
          allArticles.push(article);
        }
      }
      totalUnread += result.totalUnread;
      remaining += result.remaining;
    }

    return {
      articles: allArticles.slice(0, limit),
      totalUnread,
      remaining,
    };
  }

  async fetchContent(url: string): Promise<FetchContentResult> {
    return this.scrapers[0].fetchContent(url);
  }

  async markAsRead(articleId: string, url: string): Promise<void> {
    for (const scraper of this.scrapers) {
      await scraper.markAsRead(articleId, url);
    }
  }

  async close(): Promise<void> {
    for (const scraper of this.scrapers) {
      await scraper.close();
    }
  }
}
