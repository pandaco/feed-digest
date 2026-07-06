import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Article, StoragePort } from '@feed-digest/core';

type Collection = 'INBOX' | 'ALL' | 'SAVED';

type WriteRequest =
  | { PutRequest: { Item: Record<string, unknown> } }
  | { DeleteRequest: { Key: Record<string, unknown> } };

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

  async purgeExpiredArticles(days: number): Promise<number> {
    // No-op for AWS DynamoDB as it handles TTL natively via the 'expiresAt' attribute.
    // The attribute is added in articleToItem().
    console.log(`[DynamoDbStorage] Native TTL is enabled (retention: ${days} days). Manual purge skipped.`);
    return 0;
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

    // TTL for ALL collection
    if (collection === 'ALL') {
      const retentionDays = parseInt(process.env['RETENTION_DAYS_ALL'] || '30', 10);
      const retentionSeconds = retentionDays * 24 * 60 * 60;
      item['expiresAt'] = Math.floor(Date.now() / 1000) + retentionSeconds;
    }

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
    // SK = articleId, so we always know the full key — no pre-query needed.
    // Dedupe: BatchWriteItem rejects duplicate keys within one call.
    const uniqueIds = [...new Set(articleIds)];
    const requests = uniqueIds.map(id => ({
      DeleteRequest: { Key: { PK: `${collection}#${id}`, SK: id } },
    }));
    await this.sendBatchedRequests(requests);
    console.log(`[DynamoDbStorage] Deleted ${uniqueIds.length} articles from ${collection}`);
  }

  private async batchWrite(articles: Article[], collection: Collection): Promise<void> {
    if (articles.length === 0) return;
    const requests = articles.map(a => ({ PutRequest: { Item: this.articleToItem(a, collection) } }));
    await this.sendBatchedRequests(requests);
  }

  // BatchWriteCommand caps at 25 requests; run a few batches in parallel and
  // retry unprocessed items with exponential backoff. Every batch is
  // attempted even when one fails, and any failure is re-thrown at the end
  // so callers never report success for writes that were dropped.
  private async sendBatchedRequests(allRequests: WriteRequest[]): Promise<void> {
    const batches: WriteRequest[][] = [];
    for (let i = 0; i < allRequests.length; i += 25) {
      batches.push(allRequests.slice(i, i + 25));
    }

    const concurrency = 4;
    const failures: unknown[] = [];
    for (let i = 0; i < batches.length; i += concurrency) {
      const results = await Promise.allSettled(
        batches.slice(i, i + concurrency).map(batch => this.sendBatchWithRetry(batch))
      );
      for (const r of results) {
        if (r.status === 'rejected') failures.push(r.reason);
      }
    }

    if (failures.length > 0) {
      console.error(`[DynamoDbStorage] ${failures.length} of ${batches.length} batches failed`, failures[0]);
      throw failures[0];
    }
  }

  private async sendBatchWithRetry(batch: WriteRequest[]): Promise<void> {
    let requests = batch;
    let retries = 0;
    while (requests.length > 0 && retries < 5) {
      const result = await this.docClient.send(
        new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } })
      );
      const unprocessed = result.UnprocessedItems?.[this.tableName] ?? [];
      requests = unprocessed as WriteRequest[];
      if (requests.length > 0) {
        retries++;
        await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100));
      }
    }
    if (requests.length > 0) {
      throw new Error(`[DynamoDbStorage] BatchWrite gave up after ${retries} retries with ${requests.length} unprocessed requests`);
    }
  }
}
