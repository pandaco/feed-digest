import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { TelegramAdapter, createStorage, createSession, createTagPreference } from '@feed-digest/adapters';
import { handleCallback } from '@feed-digest/pipeline';
import { TagPreferencePort } from '@feed-digest/core';

function validateSecretToken(event: APIGatewayProxyEventV2): boolean {
  const secretToken = event.headers['x-telegram-bot-api-secret-token']
    || event.headers['X-Telegram-Bot-Api-Secret-Token'];
  return secretToken === process.env['TELEGRAM_SECRET_TOKEN'];
}

function validateRequest(event: APIGatewayProxyEventV2): { chatId: string; callbackQuery: any } | null {
  if (!validateSecretToken(event)) {
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

async function handlePreferencesApi(
  event: APIGatewayProxyEventV2,
  tagPreference: TagPreferencePort,
): Promise<APIGatewayProxyResultV2 | null> {
  const path = event.rawPath || '';
  const method = event.requestContext?.http?.method || '';

  const match = path.match(/^\/api\/preferences\/(.+)$/);
  if (!match) return null;

  if (!validateSecretToken(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const chatId = match[1];

  if (method === 'GET') {
    const prefs = await tagPreference.get(chatId);
    if (!prefs) {
      return { statusCode: 200, body: JSON.stringify({ chatId, tags: {}, scores: {} }) };
    }

    const threshold = parseFloat(process.env['TAG_PREFERENCE_THRESHOLD'] || '0.6');
    const minRuns = parseInt(process.env['TAG_PREFERENCE_MIN_RUNS'] || '3', 10);

    const scores: Record<string, { score: number; autoSelected: boolean }> = {};
    for (const [tag, stats] of Object.entries(prefs.tags)) {
      const score = stats.presentedCount > 0 ? stats.selectionCount / stats.presentedCount : 0;
      scores[tag] = {
        score,
        autoSelected: stats.presentedCount >= minRuns && score >= threshold,
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ...prefs, scores, threshold, minRuns }),
    };
  }

  if (method === 'DELETE') {
    await tagPreference.reset(chatId);
    return { statusCode: 200, body: JSON.stringify({ message: 'Preferences reset' }) };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tagPreference = createTagPreference();

  // Handle API routes for preferences
  const apiResponse = await handlePreferencesApi(event, tagPreference);
  if (apiResponse) return apiResponse;

  // Handle Telegram callback
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
      tagPreference,
      summaryLang: process.env['SUMMARY_LANG'] || 'fr',
    });
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('[Lambda] Error handling callback:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
