import { Client } from '@notionhq/client';
import pLimit from 'p-limit';
import { Article, StoragePort } from '@feed-digest/core';

const OPTIONAL_PROPERTIES = ['Scraper Source', 'Relevance Score', 'Snoozed Until'] as const;

export class NotionAdapter implements StoragePort {
  private client: Client;
  private apiKey: string;
  private inboxDbId: string;
  private allDbId: string;
  private savedDbId: string;
  private skippedProperties = new Set<string>();

  constructor(config: {
    apiKey: string;
    inboxDatabaseId: string;
    allDatabaseId: string;
    savedDatabaseId: string;
  }) {
    this.client = new Client({ auth: config.apiKey });
    this.apiKey = config.apiKey;
    this.inboxDbId = config.inboxDatabaseId;
    this.allDbId = config.allDatabaseId;
    this.savedDbId = config.savedDatabaseId;
  }

  /**
   * Custom query function to bypass a bug in Notion SDK v5.14.0 
   * where databases.query is missing/broken and dataSources.query returns 404.
   */
  private async queryDatabase(databaseId: string, filter?: any, sorts?: any, start_cursor?: string): Promise<any> {
    const body: any = {};
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (start_cursor) body.start_cursor = start_cursor;

    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async appendToInbox(articles: Article[]): Promise<void> {
    console.log(`[NotionAdapter] Appending ${articles.length} articles to Inbox...`);
    await this.appendArticles(this.inboxDbId, articles);
  }

  async appendToAll(articles: Article[]): Promise<void> {
    console.log(`[NotionAdapter] Appending ${articles.length} articles to All...`);
    await this.appendArticles(this.allDbId, articles);
  }

  async appendToSaved(articles: Article[]): Promise<void> {
    console.log(`[NotionAdapter] Appending ${articles.length} articles to Saved...`);
    await this.appendArticles(this.savedDbId, articles);
  }

  async getFromSaved(): Promise<Article[]> {
    const articles: Article[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.queryDatabase(
        this.savedDbId,
        undefined,
        [{ property: 'Run At', direction: 'descending' }],
        cursor
      );

      for (const page of response.results) {
        if (!('properties' in page)) continue;
        articles.push({ ...this.mapPageToArticle(page.properties), isSaved: true });
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return articles;
  }

  async deleteFromSaved(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    console.log(`[NotionAdapter] Deleting ${articleIds.length} articles from Saved...`);

    const limit = pLimit(5);
    let deleted = 0;

    await Promise.all(articleIds.map(articleId => limit(async () => {
      const results = await this.queryDatabase(this.savedDbId, {
        property: 'Article ID',
        rich_text: { equals: articleId },
      });

      for (const page of results.results) {
        if (!('id' in page)) continue;
        if ((page as any).archived || (page as any).in_trash) continue;

        try {
          await this.client.pages.update({ page_id: page.id, in_trash: true });
          deleted++;
        } catch (err: any) {
          if (err?.code === 'validation_error' && err?.message?.includes('archived')) {
            // Already archived concurrently
          } else {
            throw err;
          }
        }
      }
    })));

    console.log(`[NotionAdapter] Deleted ${deleted} articles from Saved.`);
  }

  async deleteFromInbox(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    console.log(`[NotionAdapter] Deleting ${articleIds.length} articles from Inbox...`);

    const limit = pLimit(5);
    let deleted = 0;

    await Promise.all(articleIds.map(articleId => limit(async () => {
      const results = await this.queryDatabase(this.inboxDbId, {
        property: 'Article ID',
        rich_text: { equals: articleId },
      });

      for (const page of results.results) {
        if (!('id' in page)) continue;

        if ((page as any).archived || (page as any).in_trash) {
          continue;
        }

        try {
          await this.client.pages.update({
            page_id: page.id,
            in_trash: true,
          });
          deleted++;
        } catch (err: any) {
          if (err?.code === 'validation_error' && err?.message?.includes('archived')) {
            // Already archived concurrently, skip
          } else {
            throw err;
          }
        }
      }
    })));

    console.log(`[NotionAdapter] Deleted ${deleted} articles from Inbox.`);
  }

  async getUntaggedArticles(): Promise<Article[]> {
    const articles: Article[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.queryDatabase(this.inboxDbId, {
        property: 'Tags',
        rich_text: { is_empty: true },
      }, undefined, cursor);

      for (const page of response.results) {
        if (!('properties' in page)) continue;
        articles.push(this.mapPageToArticle(page.properties));
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return articles;
  }

  async updateArticle(article: Article): Promise<void> {
    const dbIds = [this.inboxDbId, this.allDbId, this.savedDbId];

    for (const dataSourceId of dbIds) {
      const results = await this.queryDatabase(dataSourceId, {
        property: 'Article ID',
        rich_text: { equals: article.id },
      });

      for (const page of results.results) {
        if (!('id' in page)) continue;
        console.log(`[NotionAdapter] Updating article ${article.id} in page ${page.id}...`);

        const updateProps: Record<string, any> = {
          'Title': { title: [{ text: { content: article.title } }] },
          'Published At': { rich_text: [{ text: { content: article.publishedAt } }] },
          'Tags': { rich_text: [{ text: { content: article.tags.join(', ') } }] },
          'Summary': { rich_text: [{ text: { content: article.summary.substring(0, 2000) } }] },
          'Importance': { rich_text: [{ text: { content: article.importance } }] },
          'Content Unavailable': { checkbox: article.contentUnavailable },
          'LLM Provider': { rich_text: [{ text: { content: article.llmProvider } }] },
          'Summary Language': { rich_text: [{ text: { content: article.summaryLanguage } }] },
          'Scraper Source': { rich_text: [{ text: { content: article.scraperSource || '' } }] },
          'Relevance Score': { rich_text: [{ text: { content: article.relevanceScore != null ? String(article.relevanceScore) : '' } }] },
          'Snoozed Until': { rich_text: [{ text: { content: article.snoozedUntil || '' } }] },
        };
        for (const prop of this.skippedProperties) {
          delete updateProps[prop];
        }

        let retried = false;
        while (true) {
          try {
            await this.client.pages.update({ page_id: page.id, properties: updateProps as any });
            break;
          } catch (err: any) {
            const missing = this.extractMissingProperty(err?.message ?? '');
            if (!retried && missing) {
              console.warn(`[NotionAdapter] "${missing}" property not found, skipping it.`);
              this.skippedProperties.add(missing);
              delete updateProps[missing];
              retried = true;
            } else {
              throw err;
            }
          }
        }
      }
    }
  }

  private mapPageToArticle(props: any): Article {
    return {
      id: this.getRichText(props['Article ID']),
      runAt: this.getRichText(props['Run At']),
      publishedAt: this.getRichText(props['Published At']),
      feedSource: this.getRichText(props['Source']),
      title: this.getTitle(props['Title']),
      url: this.getUrl(props['URL']),
      tags: this.getRichText(props['Tags']).split(', ').filter(Boolean),
      summary: this.getRichText(props['Summary']),
      importance: this.getRichText(props['Importance']) as Article['importance'],
      contentUnavailable: this.getCheckbox(props['Content Unavailable']),
      llmProvider: this.getRichText(props['LLM Provider']) as Article['llmProvider'],
      summaryLanguage: this.getRichText(props['Summary Language']),
      isSaved: false,
      scraperSource: this.getRichText(props['Scraper Source']),
      relevanceScore: parseInt(this.getRichText(props['Relevance Score']), 10) || undefined,
      snoozedUntil: this.getRichText(props['Snoozed Until']) || undefined,
    };
  }

  async getFromInbox(): Promise<Article[]> {
    const articles: Article[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.queryDatabase(
        this.inboxDbId, 
        undefined, 
        [{ property: 'Run At', direction: 'descending' }], 
        cursor
      );

      for (const page of response.results) {
        if (!('properties' in page)) continue;
        articles.push(this.mapPageToArticle(page.properties));
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return articles;
  }

  private buildArticleProperties(article: Article): Record<string, any> {
    const props: Record<string, any> = {
      'Title': { title: [{ text: { content: article.title } }] },
      'Article ID': { rich_text: [{ text: { content: article.id } }] },
      'Run At': { rich_text: [{ text: { content: article.runAt } }] },
      'Published At': { rich_text: [{ text: { content: article.publishedAt } }] },
      'Source': { rich_text: [{ text: { content: article.feedSource } }] },
      'URL': { url: article.url },
      'Tags': { rich_text: [{ text: { content: article.tags.join(', ') } }] },
      'Summary': { rich_text: [{ text: { content: article.summary.substring(0, 2000) } }] },
      'Importance': { rich_text: [{ text: { content: article.importance } }] },
      'Content Unavailable': { checkbox: article.contentUnavailable },
      'LLM Provider': { rich_text: [{ text: { content: article.llmProvider } }] },
      'Summary Language': { rich_text: [{ text: { content: article.summaryLanguage } }] },
      'Scraper Source': { rich_text: [{ text: { content: article.scraperSource || '' } }] },
      'Relevance Score': { rich_text: [{ text: { content: article.relevanceScore != null ? String(article.relevanceScore) : '' } }] },
      'Snoozed Until': { rich_text: [{ text: { content: article.snoozedUntil || '' } }] },
    };
    for (const prop of this.skippedProperties) {
      delete props[prop];
    }
    return props;
  }

  private extractMissingProperty(errorMessage: string): string | null {
    for (const prop of OPTIONAL_PROPERTIES) {
      if (errorMessage.includes(`${prop} is not a property`)) return prop;
    }
    return null;
  }

  private async appendArticles(databaseId: string, articles: Article[]): Promise<void> {
    if (articles.length === 0) {
      console.log('[NotionAdapter] No articles to append.');
      return;
    }

    for (const article of articles) {
      const props = this.buildArticleProperties(article);
      let retried = false;
      while (true) {
        try {
          await this.client.pages.create({ parent: { database_id: databaseId }, properties: props });
          break;
        } catch (err: any) {
          const missing = this.extractMissingProperty(err?.message ?? '');
          if (!retried && missing) {
            console.warn(`[NotionAdapter] "${missing}" property not found, skipping it.`);
            this.skippedProperties.add(missing);
            delete props[missing];
            retried = true;
          } else {
            throw err;
          }
        }
      }
    }

    console.log(`[NotionAdapter] Appended ${articles.length} articles.`);
  }

  private getRichText(prop: unknown): string {
    const p = prop as { type?: string; rich_text?: Array<{ plain_text: string }> };
    if (p?.type === 'rich_text' && p.rich_text) {
      return p.rich_text.map(t => t.plain_text).join('');
    }
    return '';
  }

  private getTitle(prop: unknown): string {
    const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
    if (p?.type === 'title' && p.title) {
      return p.title.map(t => t.plain_text).join('');
    }
    return '';
  }

  private getUrl(prop: unknown): string {
    const p = prop as { type?: string; url?: string | null };
    if (p?.type === 'url' && p.url) {
      return p.url;
    }
    return '';
  }

  private getCheckbox(prop: unknown): boolean {
    const p = prop as { type?: string; checkbox?: boolean };
    if (p?.type === 'checkbox') {
      return p.checkbox ?? false;
    }
    return false;
  }
}
