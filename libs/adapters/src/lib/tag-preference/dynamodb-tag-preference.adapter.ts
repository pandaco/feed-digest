import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TagPreference, TagPreferencePort } from '@feed-digest/core';

export class DynamoDbTagPreferenceAdapter implements TagPreferencePort {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: { region: string; tableName: string }) {
    const client = new DynamoDBClient({ region: config.region });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = config.tableName;
  }

  async record(chatId: string, selections: Record<string, boolean>): Promise<void> {
    const existing = await this.get(chatId);
    const tags = existing?.tags ?? {};
    const now = new Date().toISOString();

    for (const [tag, selected] of Object.entries(selections)) {
      if (!tags[tag]) {
        tags[tag] = { selectionCount: 0, presentedCount: 0 };
      }
      tags[tag].presentedCount++;
      if (selected) {
        tags[tag].selectionCount++;
        tags[tag].lastSelectedAt = now;
      }
    }

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { chatId, tags },
      })
    );
    console.log(`[DynamoDbTagPref] Preferences recorded for chatId: ${chatId}`);
  }

  async get(chatId: string): Promise<TagPreference | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { chatId },
      })
    );

    const item = response.Item as TagPreference | undefined;
    return item ?? null;
  }

  async reset(chatId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { chatId },
      })
    );
    console.log(`[DynamoDbTagPref] Preferences reset for chatId: ${chatId}`);
  }
}
