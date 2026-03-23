import { describe, it, expect, vi } from 'vitest';
import { handleCallback } from './handle-callback';

function createMockSession(session: any) {
  return {
    get: vi.fn().mockResolvedValue(session),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStorage() {
  return {
    appendToInbox: vi.fn(),
    appendToAll: vi.fn(),
    deleteFromInbox: vi.fn().mockResolvedValue(undefined),
    getFromInbox: vi.fn(),
    getUntaggedArticles: vi.fn(),
    appendToSaved: vi.fn(),
    updateArticle: vi.fn(),
  };
}

function createMockNotifier() {
  return {
    sendRunSummary: vi.fn(),
    sendSourceStats: vi.fn(),
    sendSynthesis: vi.fn(),
    sendTagSelection: vi.fn(),
    updateButtons: vi.fn().mockResolvedValue(undefined),
    sendConfirmation: vi.fn().mockResolvedValue(undefined),
    sendTagArticles: vi.fn(),
    sendSavedArticles: vi.fn(),
    sendError: vi.fn(),
  };
}

describe('handleCallback', () => {
  it('should record tag preferences on validate', async () => {
    const session = createMockSession({
      chatId: 'chat1',
      messageId: '100',
      runAt: '2026-01-01T00:00:00Z',
      tags: {
        AI: { selected: true, articleIds: ['a1'] },
        Cloud: { selected: false, articleIds: ['a2'] },
        Security: { selected: true, articleIds: ['a1', 'a2'] },
      },
      tagOrder: ['AI', 'Cloud', 'Security'],
      ttl: Math.floor(Date.now() / 1000) + 43200,
    });

    const storage = createMockStorage();
    const notifier = createMockNotifier();
    const tagPreference = {
      get: vi.fn(),
      record: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    };

    await handleCallback({
      callbackQuery: {
        message: { chat: { id: 'chat1' }, message_id: 100 },
        data: 'validate',
      },
      session,
      storage,
      notifier,
      summaryLang: 'fr',
      tagPreference,
    });

    expect(tagPreference.record).toHaveBeenCalledWith('chat1', {
      AI: true,
      Cloud: false,
      Security: true,
    });
  });

  it('should not call record when tagPreference is not provided', async () => {
    const session = createMockSession({
      chatId: 'chat1',
      messageId: '100',
      runAt: '2026-01-01T00:00:00Z',
      tags: {
        AI: { selected: true, articleIds: ['a1'] },
      },
      tagOrder: ['AI'],
      ttl: Math.floor(Date.now() / 1000) + 43200,
    });

    const storage = createMockStorage();
    const notifier = createMockNotifier();

    // Should not throw when tagPreference is omitted
    await handleCallback({
      callbackQuery: {
        message: { chat: { id: 'chat1' }, message_id: 100 },
        data: 'validate',
      },
      session,
      storage,
      notifier,
      summaryLang: 'fr',
    });

    expect(session.delete).toHaveBeenCalledWith('chat1');
  });
});
