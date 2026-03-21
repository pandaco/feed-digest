import { NotifierPort, SessionPort, StoragePort } from '@feed-digest/core';

export interface HandleCallbackOptions {
  callbackQuery: any;
  session: SessionPort;
  storage: StoragePort;
  notifier: NotifierPort;
  summaryLang: string;
}

/**
 * Processes incoming Telegram callback queries (button clicks).
 * Handles tag toggling and final validation/filtering.
 */
export async function handleCallback(options: HandleCallbackOptions): Promise<void> {
  const { callbackQuery, session, storage, notifier, summaryLang } = options;
  const chatId = callbackQuery.message?.chat.id.toString();
  const messageId = callbackQuery.message?.message_id.toString();
  const data = callbackQuery.data;

  if (!chatId || !messageId || !data) return;

  const currentSession = await session.get(chatId);
  if (!currentSession || currentSession.messageId !== messageId) {
    console.warn(`[Pipeline] Session not found or message mismatch for chatId: ${chatId}`);
    return;
  }

  // --- 1. Handle Tag Toggle ---
  if (data.startsWith('toggle:')) {
    const tagName = data.split('toggle:')[1];
    if (currentSession.tags[tagName]) {
      // Toggle state
      currentSession.tags[tagName].selected = !currentSession.tags[tagName].selected;
      await session.save(currentSession);
      
      // Update the main keyboard UI
      const buttonState: Record<string, boolean> = {};
      for (const [name, state] of Object.entries(currentSession.tags)) {
        buttonState[name] = state.selected;
      }
      await notifier.updateButtons(messageId, buttonState, currentSession.tagOrder);
    }
    return;
  }

  // --- 2. Handle Final Validation ---
  if (data === 'validate') {
    console.log(`[Pipeline] Validating selection for chatId: ${chatId}`);
    
    const allArticleIds = new Set(Object.values(currentSession.tags).flatMap(t => t.articleIds));
    const articlesToDelete = new Set<string>();

    for (const articleId of allArticleIds) {
      const articleTags = Object.entries(currentSession.tags)
        .filter(([, state]) => state.articleIds.includes(articleId));
      
      // INVERTED LOGIC: Keep an article only if AT LEAST ONE of its tags is CHECKED.
      // If NONE of the tags associated with the article are checked, delete it.
      const isAnyTagChecked = articleTags.some(([, state]) => state.selected);
      if (!isAnyTagChecked) {
        articlesToDelete.add(articleId);
      }
    }

    if (articlesToDelete.size > 0) {
      console.log(`[Pipeline] Deleting ${articlesToDelete.size} filtered articles from Inbox...`);
      await storage.deleteFromInbox(Array.from(articlesToDelete));
    }

    const totalKept = allArticleIds.size - articlesToDelete.size;

    // Cleanup session and notify
    await session.delete(chatId);
    await notifier.sendConfirmation(totalKept, articlesToDelete.size, summaryLang);
    return;
  }
}
