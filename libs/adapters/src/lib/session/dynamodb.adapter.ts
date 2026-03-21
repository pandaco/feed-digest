import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  DeleteCommand 
} from '@aws-sdk/lib-dynamodb';
import { TelegramSession, SessionPort } from '@feed-digest/core';

export class DynamoDbAdapter implements SessionPort {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: { region: string; tableName: string }) {
    const client = new DynamoDBClient({ region: config.region });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = config.tableName;
  }

  async save(session: TelegramSession): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: session,
      })
    );
    console.log(`[DynamoDbAdapter] Session saved for chatId: ${session.chatId}`);
  }

  async get(chatId: string): Promise<TelegramSession | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { chatId },
      })
    );

    const item = response.Item as TelegramSession | undefined;
    if (!item) return null;

    // Manual TTL check (optional since DynamoDB handles it, but safer)
    if (item.ttl < Math.floor(Date.now() / 1000)) {
      console.log(`[DynamoDbAdapter] Session expired for chatId: ${chatId}`);
      return null;
    }

    return item;
  }

  async delete(chatId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { chatId },
      })
    );
    console.log(`[DynamoDbAdapter] Session deleted for chatId: ${chatId}`);
  }
}
