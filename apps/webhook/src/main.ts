import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  DynamoDbAdapter,
  FileSessionAdapter,
  GoogleSheetsAdapter,
  NotionAdapter,
  TelegramAdapter
} from '@feed-digest/adapters';
import { StoragePort } from '@feed-digest/core';
import { handleCallback } from '@feed-digest/pipeline';

function createStorage(): StoragePort {
  const backend = process.env['STORAGE_BACKEND'] || 'google-sheets';
  switch (backend) {
    case 'google-sheets':
      return new GoogleSheetsAdapter({
        spreadsheetId: process.env['GOOGLE_SHEET_ID']!,
        serviceAccountJson: process.env['GOOGLE_SERVICE_ACCOUNT_JSON']!,
      });
    case 'notion':
      return new NotionAdapter({
        apiKey: process.env['NOTION_API_KEY']!,
        inboxDatabaseId: process.env['NOTION_INBOX_DB_ID']!,
        allDatabaseId: process.env['NOTION_ALL_DB_ID']!,
        savedDatabaseId: process.env['NOTION_SAVED_DB_ID']!,
      });
    default:
      throw new Error(`[Lambda] Unknown STORAGE_BACKEND: "${backend}". Supported: google-sheets, notion`);
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // 1. Security Validation
  const secretToken = event.headers['x-telegram-bot-api-secret-token'] || event.headers['X-Telegram-Bot-Api-Secret-Token'];
  if (secretToken !== process.env['TELEGRAM_SECRET_TOKEN']) {
    console.error('[Lambda] Invalid secret token');
    return { statusCode: 403, body: 'Forbidden' };
  }

  const body = event.body ? JSON.parse(event.body) : null;
  if (!body || !body.callback_query) {
    return { statusCode: 200, body: 'OK' }; // Not a callback query
  }

  const chatId = body.callback_query.message?.chat.id.toString();
  if (chatId !== process.env['TELEGRAM_CHAT_ID']) {
    console.warn('[Lambda] Unauthorized chat ID');
    return { statusCode: 200, body: 'OK' };
  }

  // 2. Adapter Initialization
  const session = process.env['NODE_ENV'] === 'development'
    ? new FileSessionAdapter()
    : new DynamoDbAdapter({
        region: process.env['AWS_REGION'] || 'eu-west-1',
        tableName: process.env['DYNAMODB_TABLE_NAME']!,
      });

  const storage = createStorage();

  const notifier = new TelegramAdapter({
    token: process.env['TELEGRAM_BOT_TOKEN']!,
    chatId: process.env['TELEGRAM_CHAT_ID']!,
  });

  const summaryLang = process.env['SUMMARY_LANG'] || 'fr';

  // 3. Logic Orchestration
  try {
    await handleCallback({
      callbackQuery: body.callback_query,
      session,
      storage,
      notifier,
      summaryLang
    });

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('[Lambda] Error handling callback:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
