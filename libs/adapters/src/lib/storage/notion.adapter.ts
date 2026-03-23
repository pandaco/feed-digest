import { Client } from '@notionhq/client';
import { Article, StoragePort } from '@feed-digest/core';

export class NotionAdapter implements StoragePort {
  private client: Client;
  private apiKey: string;
  private inboxDbId: string;
  private allDbId: string;
  private savedDbId: string;

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

  async deleteFromInbox(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    console.log(`[NotionAdapter] Deleting ${articleIds.length} articles from Inbox...`);

    for (const articleId of articleIds) {
      const results = await this.queryDatabase(this.inboxDbId, {
        property: 'Article ID',
        rich_text: { equals: articleId },
      });

      for (const page of results.results) {
        if (!('id' in page)) continue;
        
        // Skip if already archived to avoid "Can't edit block that is archived" error
        if ((page as any).archived || (page as any).in_trash) {
          console.log(`[NotionAdapter] Page ${page.id} is already archived, skipping.`);
          continue;
        }

        try {
          await this.client.pages.update({
            page_id: page.id,
            in_trash: true,
          });
        } catch (err: any) {
          if (err?.code === 'validation_error' && err?.message?.includes('archived')) {
            console.log(`[NotionAdapter] Page ${page.id} was archived concurrently, skipping.`);
          } else {
            throw err;
          }
        }
      }
    }

    console.log(`[NotionAdapter] Deleted ${articleIds.length} articles from Inbox.`);
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
        await this.client.pages.update({
          page_id: page.id,
          properties: {
            'Title': {
              title: [{ text: { content: article.title } }],
            },
            'Tags': {
              rich_text: [{ text: { content: article.tags.join(', ') } }],
            },
            'Summary': {
              rich_text: [{ text: { content: article.summary.substring(0, 2000) } }],
            },
            'Importance': {
              rich_text: [{ text: { content: article.importance } }],
            },
            'Content Unavailable': {
              checkbox: article.contentUnavailable,
            },
            'LLM Provider': {
              rich_text: [{ text: { content: article.llmProvider } }],
            },
            'Summary Language': {
              rich_text: [{ text: { content: article.summaryLanguage } }],
            },
          } as any,
        });
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

  private async appendArticles(databaseId: string, articles: Article[]): Promise<void> {
    if (articles.length === 0) {
      console.log('[NotionAdapter] No articles to append.');
      return;
    }

    for (const article of articles) {
      await this.client.pages.create({
        parent: { database_id: databaseId },
        properties: {
          'Title': {
            title: [{ text: { content: article.title } }],
          },
          'Article ID': {
            rich_text: [{ text: { content: article.id } }],
          },
          'Run At': {
            rich_text: [{ text: { content: article.runAt } }],
          },
          'Published At': {
            rich_text: [{ text: { content: article.publishedAt } }],
          },
          'Source': {
            rich_text: [{ text: { content: article.feedSource } }],
          },
          'URL': {
            url: article.url,
          },
          'Tags': {
            rich_text: [{ text: { content: article.tags.join(', ') } }],
          },
          'Summary': {
            rich_text: [{ text: { content: article.summary.substring(0, 2000) } }],
          },
          'Importance': {
            rich_text: [{ text: { content: article.importance } }],
          },
          'Content Unavailable': {
            checkbox: article.contentUnavailable,
          },
          'LLM Provider': {
            rich_text: [{ text: { content: article.llmProvider } }],
          },
          'Summary Language': {
            rich_text: [{ text: { content: article.summaryLanguage } }],
          },
        },
      });
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
