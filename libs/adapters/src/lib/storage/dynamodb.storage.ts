import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Article, StoragePort } from '@feed-digest/core';

type Collection = 'INBOX' | 'ALL' | 'SAVED';

export class DynamoDbStorage implements StoragePort {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: { region: string; tableName: string; endpoint?: string }) {
    const client = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = config.tableName;
  }

  // ---------------------------------------------------------------------------
  // Inbox
  // ---------------------------------------------------------------------------

  async appendToInbox(articles: Article[]): Promise<void> {
    await this.batchWrite(articles, 'INBOX');
    console.log(`[DynamoDbStorage] Appended ${articles.length} articles to INBOX`);
  }

  async getFromInbox(): Promise<Article[]> {
    return this.queryCollection('INBOX');
  }

  async deleteFromInbox(articleIds: string[]): Promise<void> {
    await this.deleteFromCollection(articleIds, 'INBOX');
  }

  async getUntaggedArticles(): Promise<Article[]> {
    const articles = await this.queryCollection('INBOX');
    return articles.filter(a => !a.tags || a.tags.length === 0);
  }

  // ---------------------------------------------------------------------------
  // All
  // ---------------------------------------------------------------------------

  async appendToAll(articles: Article[]): Promise<void> {
    await this.batchWrite(articles, 'ALL');
    console.log(`[DynamoDbStorage] Appended ${articles.length} articles to ALL`);
  }

  // ---------------------------------------------------------------------------
  // Saved
  // ---------------------------------------------------------------------------

  async appendToSaved(articles: Article[]): Promise<void> {
    await this.batchWrite(articles, 'SAVED');
    console.log(`[DynamoDbStorage] Appended ${articles.length} articles to SAVED`);
  }

  async getFromSaved(): Promise<Article[]> {
    return this.queryCollection('SAVED');
  }

  async deleteFromSaved(articleIds: string[]): Promise<void> {
    await this.deleteFromCollection(articleIds, 'SAVED');
  }

  // ---------------------------------------------------------------------------
  // Update (snooze, tags, relevance score…)
  // ---------------------------------------------------------------------------

  async updateArticle(article: Article): Promise<void> {
    for (const collection of ['INBOX', 'ALL'] as Collection[]) {
      try {
        const updateParts: string[] = [
          '#title = :title',
          '#tags = :tags',
          '#summary = :summary',
          '#importance = :importance',
          '#isSaved = :isSaved',
        ];
        const expressionNames: Record<string, string> = {
          '#title': 'title',
          '#tags': 'tags',
          '#summary': 'summary',
          '#importance': 'importance',
          '#isSaved': 'isSaved',
        };
        const expressionValues: Record<string, unknown> = {
          ':title': article.title,
          ':tags': article.tags,
          ':summary': article.summary,
          ':importance': article.importance,
          ':isSaved': article.isSaved,
        };

        const removeParts: string[] = [];

        if (article.snoozedUntil) {
          updateParts.push('#snoozedUntil = :snoozedUntil');
          expressionNames['#snoozedUntil'] = 'snoozedUntil';
          expressionValues[':snoozedUntil'] = article.snoozedUntil;
        } else {
          removeParts.push('#snoozedUntil');
          expressionNames['#snoozedUntil'] = 'snoozedUntil';
        }

        if (article.relevanceScore != null) {
          updateParts.push('#relevanceScore = :relevanceScore');
          expressionNames['#relevanceScore'] = 'relevanceScore';
          expressionValues[':relevanceScore'] = article.relevanceScore;
        }

        let updateExpression = `SET ${updateParts.join(', ')}`;
        if (removeParts.length > 0) {
          updateExpression += ` REMOVE ${removeParts.join(', ')}`;
        }

        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              PK: `${collection}#${article.id}`,
              SK: article.id,
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
          })
        );
      } catch (err: any) {
        if (collection === 'ALL') {
          // ALL is best-effort — article may not exist there in all cases
          console.warn(`[DynamoDbStorage] Could not update ALL#${article.id}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private articleToItem(article: Article, collection: Collection): Record<string, unknown> {
    const item: Record<string, unknown> = {
      PK: `${collection}#${article.id}`,
      SK: article.id,
      GSI1PK: collection,
      GSI1SK: article.runAt,
      articleId: article.id,
      title: article.title,
      url: article.url,
      feedSource: article.feedSource,
      publishedAt: article.publishedAt,
      runAt: article.runAt,
      tags: article.tags,
      summary: article.summary,
      importance: article.importance,
      contentUnavailable: article.contentUnavailable,
      llmProvider: article.llmProvider,
      summaryLanguage: article.summaryLanguage,
      isSaved: article.isSaved,
      scraperSource: article.scraperSource,
    };
    if (article.relevanceScore != null) item['relevanceScore'] = article.relevanceScore;
    if (article.snoozedUntil) item['snoozedUntil'] = article.snoozedUntil;
    return item;
  }

  private itemToArticle(item: Record<string, unknown>, collection: Collection): Article {
    return {
      id: item['articleId'] as string,
      runAt: item['runAt'] as string,
      publishedAt: item['publishedAt'] as string,
      feedSource: item['feedSource'] as string,
      title: item['title'] as string,
      url: item['url'] as string,
      tags: (item['tags'] as string[]) ?? [],
      summary: item['summary'] as string,
      importance: item['importance'] as Article['importance'],
      contentUnavailable: Boolean(item['contentUnavailable']),
      llmProvider: item['llmProvider'] as Article['llmProvider'],
      summaryLanguage: item['summaryLanguage'] as string,
      isSaved: collection === 'SAVED' || Boolean(item['isSaved']),
      scraperSource: (item['scraperSource'] as string) ?? '',
      relevanceScore: item['relevanceScore'] as number | undefined,
      snoozedUntil: item['snoozedUntil'] as string | undefined,
    };
  }

  private async queryCollection(collection: Collection): Promise<Article[]> {
    const articles: Article[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': collection },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        })
      );

      for (const item of result.Items ?? []) {
        articles.push(this.itemToArticle(item as Record<string, unknown>, collection));
      }

      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return articles;
  }

  private async deleteFromCollection(articleIds: string[], collection: Collection): Promise<void> {
    // SK = articleId, so we always know the full key — no pre-query needed
    await Promise.all(
      articleIds.map(id =>
        this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: { PK: `${collection}#${id}`, SK: id },
          })
        )
      )
    );
    console.log(`[DynamoDbStorage] Deleted ${articleIds.length} articles from ${collection}`);
  }

  private async batchWrite(articles: Article[], collection: Collection): Promise<void> {
    if (articles.length === 0) return;
    const items = articles.map(a => this.articleToItem(a, collection));

    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      let requests = batch.map(item => ({ PutRequest: { Item: item } }));

      let retries = 0;
      while (requests.length > 0 && retries < 5) {
        const result = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } })
        );
        const unprocessed = result.UnprocessedItems?.[this.tableName] ?? [];
        requests = unprocessed as { PutRequest: { Item: Record<string, unknown> } }[];
        if (requests.length > 0) {
          retries++;
          await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100));
        }
      }
    }
  }
}
