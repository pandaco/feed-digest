import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { TelegramAdapter, createStorage, createSession } from '@feed-digest/adapters';
import { handleCallback } from '@feed-digest/pipeline';

function validateRequest(event: APIGatewayProxyEventV2): { chatId: string; callbackQuery: any } | null {
  const secretToken = event.headers['x-telegram-bot-api-secret-token'] || event.headers['X-Telegram-Bot-Api-Secret-Token'];
  if (secretToken !== process.env['TELEGRAM_SECRET_TOKEN']) {
    console.error('[Lambda] Invalid secret token');
    return null;
  }

  const body = event.body ? JSON.parse(event.body) : null;
  if (!body?.callback_query) return null;

  const chatId = body.callback_query.message?.chat.id.toString();
  if (chatId !== process.env['TELEGRAM_CHAT_ID']) {
    console.warn('[Lambda] Unauthorized chat ID');
    return null;
  }

  return { chatId, callbackQuery: body.callback_query };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const request = validateRequest(event);
  if (!request) {
    return { statusCode: 200, body: 'OK' };
  }

  const session = createSession();
  const storage = createStorage('Lambda');
  const notifier = new TelegramAdapter({
    token: process.env['TELEGRAM_BOT_TOKEN']!,
    chatId: process.env['TELEGRAM_CHAT_ID']!,
  });

  try {
    await handleCallback({
      callbackQuery: request.callbackQuery,
      session,
      storage,
      notifier,
      summaryLang: process.env['SUMMARY_LANG'] || 'fr',
    });
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('[Lambda] Error handling callback:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
