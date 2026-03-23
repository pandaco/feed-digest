import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildNotificationData } from './pipeline';
import { Article, TagPreferencePort, TagPreference } from '@feed-digest/core';

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art-1',
    runAt: '2026-01-01T00:00:00Z',
    publishedAt: '2026-01-01T00:00:00Z',
    feedSource: 'TestSource',
    title: 'Test Article',
    url: 'https://example.com/test',
    tags: ['AI'],
    summary: 'A test article.',
    importance: 'medium',
    contentUnavailable: false,
    llmProvider: 'claude',
    summaryLanguage: 'en',
    isSaved: false,
    ...overrides,
  };
}

function createMockTagPreference(prefs: TagPreference | null): TagPreferencePort {
  return {
    get: vi.fn().mockResolvedValue(prefs),
    record: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('buildNotificationData', () => {
  afterEach(() => {
    delete process.env['TAG_PREFERENCE_THRESHOLD'];
    delete process.env['TAG_PREFERENCE_MIN_RUNS'];
  });

  it('should work without tag preferences', async () => {
    const articles = [
      makeArticle({ id: '1', tags: ['AI', 'Cloud'] }),
      makeArticle({ id: '2', tags: ['AI', 'Security'] }),
    ];

    const result = await buildNotificationData({ articles });

    expect(result.tagCounts).toEqual({ AI: 2, Cloud: 1, Security: 1 });
    expect(result.preSelectedCount).toBe(0);
    expect(Object.keys(result.preSelected)).toHaveLength(0);
    expect(result.sessionTags['AI'].selected).toBe(false);
  });

  it('should pre-select tags above threshold with enough runs', async () => {
    const articles = [
      makeArticle({ id: '1', tags: ['AI', 'Cloud'] }),
      makeArticle({ id: '2', tags: ['Security'] }),
    ];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        AI: { selectionCount: 4, presentedCount: 5, lastSelectedAt: '2026-01-01T00:00:00Z' },
        Cloud: { selectionCount: 1, presentedCount: 5 },
        Security: { selectionCount: 3, presentedCount: 5, lastSelectedAt: '2026-01-01T00:00:00Z' },
      },
    });

    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    // AI: 4/5 = 0.8 >= 0.6 → pre-selected
    expect(result.preSelected['AI']).toBe(true);
    expect(result.sessionTags['AI'].selected).toBe(true);

    // Cloud: 1/5 = 0.2 < 0.6 → not pre-selected
    expect(result.preSelected['Cloud']).toBeUndefined();
    expect(result.sessionTags['Cloud'].selected).toBe(false);

    // Security: 3/5 = 0.6 >= 0.6 → pre-selected
    expect(result.preSelected['Security']).toBe(true);
    expect(result.sessionTags['Security'].selected).toBe(true);

    expect(result.preSelectedCount).toBe(2);
  });

  it('should not pre-select tags with too few runs', async () => {
    const articles = [makeArticle({ id: '1', tags: ['AI'] })];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        AI: { selectionCount: 2, presentedCount: 2 },
      },
    });

    // Default minRuns = 3, so 2 presentedCount is not enough
    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    expect(result.preSelected['AI']).toBeUndefined();
    expect(result.sessionTags['AI'].selected).toBe(false);
  });

  it('should respect custom threshold and minRuns env vars', async () => {
    process.env['TAG_PREFERENCE_THRESHOLD'] = '0.9';
    process.env['TAG_PREFERENCE_MIN_RUNS'] = '2';

    const articles = [makeArticle({ id: '1', tags: ['AI'] })];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        AI: { selectionCount: 2, presentedCount: 2 },
      },
    });

    // 2/2 = 1.0 >= 0.9 and presentedCount 2 >= minRuns 2 → pre-selected
    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    expect(result.preSelected['AI']).toBe(true);
  });

  it('should sort pre-selected tags first in tagOrder', async () => {
    const articles = [
      makeArticle({ id: '1', tags: ['Rare'] }),
      makeArticle({ id: '2', tags: ['Common'] }),
      makeArticle({ id: '3', tags: ['Common'] }),
      makeArticle({ id: '4', tags: ['Common'] }),
    ];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        Rare: { selectionCount: 5, presentedCount: 5 },
        Common: { selectionCount: 0, presentedCount: 5 },
      },
    });

    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    // Rare is pre-selected (score=1.0) so should appear before Common despite lower count
    expect(result.tagOrder[0]).toBe('Rare');
    expect(result.tagOrder[1]).toBe('Common');
  });
});
