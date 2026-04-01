import { describe, it, expect, vi, afterEach } from 'vitest';
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
    tags: ['ai'],
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
      makeArticle({ id: '1', tags: ['ai', 'cloud'] }),
      makeArticle({ id: '2', tags: ['ai', 'security'] }),
    ];

    const result = await buildNotificationData({ articles });

    expect(result.tagCounts).toEqual({ ai: 2, cloud: 1, security: 1 });
    expect(result.preSelectedCount).toBe(0);
    expect(Object.keys(result.preSelected)).toHaveLength(0);
    expect(result.sessionTags['ai'].selected).toBe(false);
  });

  it('should pre-select tags above threshold with enough runs', async () => {
    const articles = [
      makeArticle({ id: '1', tags: ['ai', 'cloud'] }),
      makeArticle({ id: '2', tags: ['security'] }),
    ];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        ai: { selectionCount: 4, presentedCount: 5, lastSelectedAt: '2026-01-01T00:00:00Z' },
        cloud: { selectionCount: 1, presentedCount: 5 },
        security: { selectionCount: 3, presentedCount: 5, lastSelectedAt: '2026-01-01T00:00:00Z' },
      },
    });

    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    // ai: 4/5 = 0.8 >= 0.6 → pre-selected
    expect(result.preSelected['ai']).toBe(true);
    expect(result.sessionTags['ai'].selected).toBe(true);

    // cloud: 1/5 = 0.2 < 0.6 → not pre-selected
    expect(result.preSelected['cloud']).toBeUndefined();
    expect(result.sessionTags['cloud'].selected).toBe(false);

    // security: 3/5 = 0.6 >= 0.6 → pre-selected
    expect(result.preSelected['security']).toBe(true);
    expect(result.sessionTags['security'].selected).toBe(true);

    expect(result.preSelectedCount).toBe(2);
  });

  it('should not pre-select tags with too few runs', async () => {
    const articles = [makeArticle({ id: '1', tags: ['ai'] })];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        ai: { selectionCount: 2, presentedCount: 2 },
      },
    });

    // Default minRuns = 3, so 2 presentedCount is not enough
    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    expect(result.preSelected['ai']).toBeUndefined();
    expect(result.sessionTags['ai'].selected).toBe(false);
  });

  it('should respect custom threshold and minRuns env vars', async () => {
    process.env['TAG_PREFERENCE_THRESHOLD'] = '0.9';
    process.env['TAG_PREFERENCE_MIN_RUNS'] = '2';

    const articles = [makeArticle({ id: '1', tags: ['ai'] })];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        ai: { selectionCount: 2, presentedCount: 2 },
      },
    });

    // 2/2 = 1.0 >= 0.9 and presentedCount 2 >= minRuns 2 → pre-selected
    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    expect(result.preSelected['ai']).toBe(true);
  });

  it('should sort pre-selected tags first in tagOrder', async () => {
    const articles = [
      makeArticle({ id: '1', tags: ['rare'] }),
      makeArticle({ id: '2', tags: ['common'] }),
      makeArticle({ id: '3', tags: ['common'] }),
      makeArticle({ id: '4', tags: ['common'] }),
    ];

    const tagPref = createMockTagPreference({
      chatId: 'chat1',
      tags: {
        rare: { selectionCount: 5, presentedCount: 5 },
        common: { selectionCount: 0, presentedCount: 5 },
      },
    });

    const result = await buildNotificationData({
      articles,
      tagPreference: tagPref,
      chatId: 'chat1',
    });

    // rare is pre-selected (score=1.0) so should appear before common despite lower count
    expect(result.tagOrder[0]).toBe('rare');
    expect(result.tagOrder[1]).toBe('common');
  });
});
